import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// 1. Setup Local Uploads Folder & JSON Database File
const UPLOADS_DIR = path.resolve('uploads');
const DB_FILE = path.resolve('database.json');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));

// Serve uploaded photos publicly so the frontend can display them if needed
app.use('/uploads', express.static(UPLOADS_DIR));

// Helper functions to read/write local database.json
const readTickets = () => JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
const writeTickets = (data) => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

// Configure Multer to save images directly to /backend/uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`)
});
const upload = multer({ storage });

// Initialize Gemini AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const triageSchema = {
  type: Type.OBJECT,
  properties: {
    category: {
      type: Type.STRING,
      description: 'Strictly one of: "Electrical Works", "Plumbing & Water", "IT Systems / AV", "Carpentry & Civil"'
    },
    severity: {
      type: Type.STRING,
      description: 'Strictly one of: "Low", "Medium", "High", "Critical"'
    },
    sla: {
      type: Type.STRING,
      description: 'Estimated SLA timeframe, e.g., "2 Hours", "12 Hours", "24 Hours"'
    },
    summary: {
      type: Type.STRING,
      description: 'Short 4 to 7 word summary of the issue'
    }
  },
  required: ['category', 'severity', 'sla', 'summary']
};

// ROUTE 1: Create Ticket + AI Triage + 6-Hour Duplicate Check
app.post('/api/tickets', upload.single('image'), async (req, res) => {
  try {
    const { location, description } = req.body;
    const promptParts = [
      `Analyze this campus maintenance report. Location: ${location}. Description: ${description}`
    ];

    // If an image was uploaded, read it from disk and send to Gemini
    if (req.file) {
      const imageBuffer = fs.readFileSync(req.file.path);
      promptParts.push({
        inlineData: {
          data: imageBuffer.toString('base64'),
          mimeType: req.file.mimetype
        }
      });
    }

    let triage;
    const modelsToTry = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash'];

    try {
      let aiResponse;
      for (const modelName of modelsToTry) {
        try {
          aiResponse = await ai.models.generateContent({
            model: modelName,
            contents: promptParts,
            config: {
              responseMimeType: 'application/json',
              responseSchema: triageSchema,
              temperature: 0.1
            }
          });
          console.log(`Triage succeeded using ${modelName}`);
          break;
        } catch (err) {
          console.warn(`${modelName} failed (${err.status || err.message}), trying next...`);
          if (modelName === modelsToTry[modelsToTry.length - 1]) throw err;
        }
      }

      triage = JSON.parse(aiResponse.text);

    } catch (fallbackError) {
      console.warn("All AI models hit 503/timeout. Using local rule-based fallback.");

      const text = (req.body.description || "").toLowerCase();
      let category = "Carpentry & Civil";
      let severity = "Medium";
      let sla = "12 Hours";

      if (text.includes("wire") || text.includes("power") || text.includes("light") || text.includes("ac") || text.includes("fan")) {
        category = "Electrical Works";
        severity = "High";
        sla = "4 Hours";
      } else if (text.includes("water") || text.includes("leak") || text.includes("pipe") || text.includes("washroom")) {
        category = "Plumbing & Water";
        severity = "High";
        sla = "4 Hours";
      } else if (text.includes("wifi") || text.includes("internet") || text.includes("projector") || text.includes("pc")) {
        category = "IT Systems / AV";
        severity = "Medium";
        sla = "12 Hours";
      }

      triage = {
        category,
        severity,
        sla,
        summary: (req.body.description || "Campus maintenance issue").slice(0, 50)
      };
    }

    // Apply Manual Overrides if selected in the frontend dropdowns
    if (req.body.deptOverride && req.body.deptOverride !== 'AUTO') {
      triage.category = req.body.deptOverride;
    }
    if (req.body.severityOverride && req.body.severityOverride !== 'AUTO') {
      triage.severity = req.body.severityOverride;
      // Automatically adjust SLA to match manual severity
      if (triage.severity === 'Critical') triage.sla = '2 Hours';
      else if (triage.severity === 'High') triage.sla = '4 Hours';
      else if (triage.severity === 'Medium') triage.sla = '12 Hours';
      else if (triage.severity === 'Low') triage.sla = '24 Hours';
    }

    const tickets = readTickets();

    // Check 6-hour duplicate in database.json
    const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
    const existingIndex = tickets.findIndex(
      (t) =>
        t.location.toLowerCase() === location.trim().toLowerCase() &&
        t.category === triage.category &&
        t.status !== 'Resolved' &&
        new Date(t.created_at).getTime() >= sixHoursAgo
    );

    if (existingIndex !== -1) {
      tickets[existingIndex].upvotes += 1;
      writeTickets(tickets);
      return res.json({
        duplicate: true,
        triage,
        ticket: tickets[existingIndex]
      });
    }

    // Create new ticket entry
    const newTicket = {
      id: Date.now().toString(),
      ticket_code: `CF-${Math.floor(1000 + Math.random() * 9000)}`,
      created_at: new Date().toISOString(),
      location: location.trim(),
      description: description.trim(),
      summary: triage.summary,
      image_url: req.file ? `http://localhost:5000/uploads/${req.file.filename}` : null,
      category: triage.category,
      severity: triage.severity,
      sla: triage.sla,
      status: 'Pending Review',
      upvotes: 1
    };

    tickets.unshift(newTicket);
    writeTickets(tickets);

    res.json({ duplicate: false, triage, ticket: newTicket });
  } catch (err) {
    console.error('AI Triage Error:', err);
    res.status(500).json({ error: 'AI Triage failed. Check your GEMINI_API_KEY in .env' });
  }
});

// ROUTE 2: Get All Tickets & KPIs
app.get('/api/tickets', (req, res) => {
  const { department, status } = req.query;
  const allTickets = readTickets();

  let filtered = allTickets;
  if (department && department !== 'ALL') {
    filtered = filtered.filter((t) => t.category === department);
  }
  if (status && status !== 'ALL') {
    filtered = filtered.filter((t) => t.status === status);
  }

  const stats = {
    total: allTickets.length,
    pending: allTickets.filter((t) => t.status === 'Pending Review' || t.status === 'Assigned').length,
    inProgress: allTickets.filter((t) => t.status === 'In Progress').length,
    resolved: allTickets.filter((t) => t.status === 'Resolved').length
  };

  res.json({ tickets: filtered, stats });
});

// ROUTE 3: Update Status
app.patch('/api/tickets/:id/status', (req, res) => {
  const tickets = readTickets();
  const index = tickets.findIndex((t) => t.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Ticket not found' });

  tickets[index].status = req.body.status;
  writeTickets(tickets);
  res.json(tickets[index]);
});

// ROUTE 4: Upvote Ticket
app.post('/api/tickets/:id/upvote', (req, res) => {
  const tickets = readTickets();
  const index = tickets.findIndex((t) => t.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Ticket not found' });

  tickets[index].upvotes += 1;
  writeTickets(tickets);
  res.json(tickets[index]);
});

// ROUTE 5: Delete Ticket
app.delete('/api/tickets/:id', (req, res) => {
  const tickets = readTickets();
  const filtered = tickets.filter((t) => t.id !== req.params.id);
  if (filtered.length === tickets.length) {
    return res.status(404).json({ error: 'Ticket not found' });
  }
  writeTickets(filtered);
  res.json({ success: true });
});

// ROUTE 6: Export Tickets as CSV
app.get('/api/tickets/export', (req, res) => {
  const tickets = readTickets();
  let csv = 'Ticket Code,Location,Category,Severity,Status,Upvotes,Summary,Created At\n';
  tickets.forEach(t => {
    csv += `"${t.ticket_code}","${t.location.replace(/"/g, '""')}","${t.category}","${t.severity}","${t.status}",${t.upvotes},"${t.summary.replace(/"/g, '""')}","${t.created_at}"\n`;
  });
  res.header('Content-Type', 'text/csv');
  res.attachment('campus-fix-reports.csv');
  res.send(csv);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));