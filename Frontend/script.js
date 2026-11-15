const API_URL = "http://localhost:5000/api";

// DOM Elements
const form = document.getElementById('incidentForm');
const imageInput = document.getElementById('imageInput');
const filterDept = document.getElementById('filterDept');
const filterStatus = document.getElementById('filterStatus');
const searchInput = document.getElementById('searchInput');

// Event Listeners
document.addEventListener('DOMContentLoaded', loadQueue);
filterDept.addEventListener('change', loadQueue);
filterStatus.addEventListener('change', loadQueue);
if (searchInput) searchInput.addEventListener('input', loadQueue);

imageInput.addEventListener('change', function () {
  if (this.files && this.files[0]) {
    document.getElementById('fileUploadPrompt').innerHTML = `
      <i class="fa-solid fa-file-image text-emerald-500 text-xl"></i>
      <p class="text-xs text-emerald-700 font-semibold">${this.files[0].name}</p>
    `;
  }
});

// Load Demo Presets
function loadPreset(type) {
  if (type === 'electrical') {
    document.getElementById('locationInput').value = "Lecture Hall B - Main Switchboard";
    document.getElementById('descInput').value = "Sparks coming out of the main AC distribution box with a burning smell.";
  } else if (type === 'plumbing') {
    document.getElementById('locationInput').value = "Hostel Block C - Washroom 1st Floor";
    document.getElementById('descInput').value = "Main water pipeline burst, flooding the corridor.";
  }
}

// Handle Form Submission -> Send to Node.js Backend
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const location = document.getElementById('locationInput').value.trim();
  const description = document.getElementById('descInput').value.trim();
  const imageFile = imageInput.files[0];

  const submitBtn = document.getElementById('submitBtn');
  const copilotStatus = document.getElementById('copilotStatus');
  const duplicateAlert = document.getElementById('duplicateAlert');

  submitBtn.disabled = true;
  submitBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i><span>AI Analyzing...</span>`;
  copilotStatus.innerText = "Processing...";
  duplicateAlert.classList.add('hidden');

  const formData = new FormData();
  formData.append('location', location);
  formData.append('description', description);
  if (imageFile) formData.append('image', imageFile);
  formData.append('deptOverride', document.getElementById('deptOverride')?.value || 'AUTO');
  formData.append('severityOverride', document.getElementById('severityOverride')?.value || 'AUTO');

  try {
    const res = await fetch(`${API_URL}/tickets`, {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');

    // Update Copilot Card
    document.getElementById('resCategory').innerText = data.triage.category;
    document.getElementById('resSeverity').innerText = data.triage.severity;
    document.getElementById('resDept').innerText = data.triage.category;
    document.getElementById('resSla').innerText = data.triage.sla;

    copilotStatus.innerText = "Triaged";
    copilotStatus.className = "bg-emerald-100 text-emerald-700 text-xs px-2.5 py-1 rounded-full font-medium";

    if (data.duplicate) {
      duplicateAlert.classList.remove('hidden');
    }

    form.reset();
    document.getElementById('fileUploadPrompt').innerHTML = `
      <i class="fa-solid fa-cloud-arrow-up text-indigo-500 text-xl"></i>
      <p class="text-xs text-slate-600 font-medium">Click to upload photo or drag & drop</p>
    `;
    loadQueue();
  } catch (err) {
    alert("Error: " + err.message);
    copilotStatus.innerText = "Error";
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i><span>Run AI Triage & Submit Report</span>`;
  }
});

// Fetch Tickets & Update Table + KPIs + Keyword Filter
async function loadQueue() {
  const dept = filterDept.value;
  const status = filterStatus.value;
  const keyword = (searchInput?.value || "").toLowerCase();

  try {
    const res = await fetch(`${API_URL}/tickets?department=${encodeURIComponent(dept)}&status=${encodeURIComponent(status)}`);
    const { tickets, stats } = await res.json();

    // Local Search Keyword Filter
    const filteredTickets = tickets.filter(t => 
      t.location.toLowerCase().includes(keyword) || 
      t.summary.toLowerCase().includes(keyword) || 
      t.ticket_code.toLowerCase().includes(keyword)
    );

    // Update KPIs
    document.getElementById('statTotal').innerText = stats.total;
    document.getElementById('statPending').innerText = stats.pending;
    document.getElementById('statProgress').innerText = stats.inProgress;
    document.getElementById('statResolved').innerText = stats.resolved;

    // Populate Table
    const tbody = document.getElementById('ticketTableBody');
    tbody.innerHTML = "";

    if (filteredTickets.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-400 text-sm">No matching tickets found.</td></tr>`;
      return;
    }

    filteredTickets.forEach(t => {
      // Color-code severity badges
      const sevColors = {
        Critical: "bg-red-100 text-red-700 border border-red-200",
        High: "bg-amber-100 text-amber-700 border border-amber-200",
        Medium: "bg-blue-100 text-blue-700 border border-blue-200",
        Low: "bg-slate-100 text-slate-600 border border-slate-200"
      };
      const badgeClass = sevColors[t.severity] || sevColors.Medium;

      // Show clickable photo thumbnail if an image was attached
      const photoLink = t.image_url
        ? `<a href="${t.image_url}" target="_blank" class="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:underline mt-1">
             <i class="fa-solid fa-image"></i> View Photo
           </a>`
        : '';

      const row = document.createElement('tr');
      row.className = "hover:bg-slate-50 transition";
      row.innerHTML = `
        <td class="py-4 px-6 font-mono text-xs font-bold text-indigo-600">${t.ticket_code}</td>
        <td class="py-4 px-6 font-medium text-slate-800 text-xs">${t.location}</td>
        <td class="py-4 px-6 text-slate-600 text-xs max-w-xs">
          <div class="truncate font-medium text-slate-700">${t.summary}</div>
          ${photoLink}
        </td>
        <td class="py-4 px-6">
          <div class="text-xs font-semibold mb-1">${t.category}</div>
          <span class="text-[10px] px-2.5 py-0.5 rounded-full font-bold ${badgeClass}">${t.severity}</span>
        </td>
        <td class="py-4 px-6 text-center">
          <button onclick="upvoteTicket('${t.id}')" class="bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 px-2.5 py-1 rounded-lg text-xs font-bold transition">
            ▲ ${t.upvotes}
          </button>
        </td>
        <td class="py-4 px-6 text-xs font-semibold">${t.status}</td>
        <td class="py-4 px-6 text-right">
          <div class="inline-flex items-center gap-2">
            <select onchange="updateStatus('${t.id}', this.value)" class="text-xs px-2 py-1 rounded-lg border border-slate-200 bg-white">
              <option value="" disabled selected>Action</option>
              <option value="Pending Review">Pending Review</option>
              <option value="Assigned">Assigned</option>
              <option value="In Progress">In Progress</option>
              <option value="Resolved">Resolved</option>
            </select>
            <button onclick="deleteTicket('${t.id}')" title="Delete Ticket" class="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition">
              <i class="fa-solid fa-trash-can text-xs"></i>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    console.error("Failed to load queue:", err);
  }
}

async function updateStatus(id, status) {
  await fetch(`${API_URL}/tickets/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  loadQueue();
}

async function upvoteTicket(id) {
  await fetch(`${API_URL}/tickets/${id}/upvote`, { method: 'POST' });
  loadQueue();
}

async function deleteTicket(id) {
  if (!confirm("Delete this ticket permanently?")) return;
  await fetch(`${API_URL}/tickets/${id}`, { method: 'DELETE' });
  loadQueue();
}

function exportCSV() {
  window.location.href = `${API_URL}/tickets/export`;
}