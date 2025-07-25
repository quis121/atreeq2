const express = require('express');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Path for IP log file
const ipLogFile = path.join(__dirname, 'iplogs.json');

// Initialize IP log file if it doesn't exist
if (!fs.existsSync(ipLogFile)) {
  fs.writeFileSync(ipLogFile, JSON.stringify([]));
}

// In-memory sessions storage (reset on server restart)
const sessions = {};

// Middleware to log visitor IP on visits to '/' or '/index.html'
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/index.html') {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const time = new Date().toISOString();

    let data = [];
    try {
      data = JSON.parse(fs.readFileSync(ipLogFile));
    } catch (e) {
      console.error('Error reading IP log file:', e);
    }

    data.push({ ip, time });

    try {
      fs.writeFileSync(ipLogFile, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('Error writing IP log file:', e);
    }
  }
  next(); // Important: allow other routes to run
});

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Excel file path
const excelFile = path.join(__dirname, 'data.xlsx');

// Create Excel file if not exists
if (!fs.existsSync(excelFile)) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([]);
  XLSX.utils.book_append_sheet(wb, ws, 'Users');
  XLSX.writeFile(wb, excelFile);
}

// Append login to Excel
function appendToExcel(phone) {
  try {
    const workbook = XLSX.readFile(excelFile);
    const worksheet = workbook.Sheets['Users'];
    const data = XLSX.utils.sheet_to_json(worksheet);
    const now = new Date().toISOString();
    data.push({ phone, loginTime: now });
    const updatedWS = XLSX.utils.json_to_sheet(data);
    workbook.Sheets['Users'] = updatedWS;
    XLSX.writeFile(workbook, excelFile);
  } catch (err) {
    console.error('❌ Failed to write to Excel:', err);
  }
}

// 🔐 Basic Auth Middleware for /log and /books and /ip
const auth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Logs"');
    return res.status(401).send('Authentication required.');
  }

  const base64 = authHeader.split(' ')[1];
  const [user, pass] = Buffer.from(base64, 'base64').toString().split(':');

  const correctUser = process.env.LOG_USER || 'qais';
  const correctPass = process.env.LOG_PASS || '1423';

  if (user === correctUser && pass === correctPass) {
    return next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="Logs"');
    return res.status(401).send('Invalid credentials.');
  }
};

// 📲 Send code via WhatsApp (simulated)
app.post('/send-code', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ message: 'Phone number required' });

  const code = Math.floor(10000 + Math.random() * 90000).toString();
  const expiry = Date.now() + 5 * 60 * 1000;

  sessions[phone] = { code, expiry };
  console.log(`📲 Code for ${phone}: ${code}`);

  const waLink = `https://wa.me/${phone.replace('+', '')}?text=Your verification code is ${code}`;
  res.json({ message: 'Code sent', code, waLink }); // remove 'code' in production
});

// ✅ Verify code
app.post('/verify-code', (req, res) => {
  const { phone, code } = req.body;
  const record = sessions[phone];

  if (!record) return res.status(400).json({ message: 'No code sent' });
  if (Date.now() > record.expiry) return res.status(400).json({ message: 'Code expired' });
  if (record.code !== code) return res.status(400).json({ message: 'Invalid code' });

  appendToExcel(phone);
  delete sessions[phone];

  res.json({ message: 'Login successful' });
});

// 📜 View login logs (password protected)
app.get('/log', auth, (req, res) => {
  try {
    const workbook = XLSX.readFile(excelFile);
    const worksheet = workbook.Sheets['Users'];
    const data = XLSX.utils.sheet_to_json(worksheet);

    let html = `
      <h1>Login Logs</h1>
      <p><a href="/books">View Booking Logs</a></p>
      <table border="1" cellpadding="5" cellspacing="0">
        <tr><th>Phone</th><th>Login Time</th></tr>
    `;

    data.forEach(entry => {
      html += `<tr><td>${entry.phone || ''}</td><td>${entry.loginTime || ''}</td></tr>`;
    });

    html += '</table>';
    res.send(html);
  } catch (err) {
    res.status(500).send('Error reading Excel file.');
  }
});

// 📜 View ride bookings (password protected)
app.get('/books', auth, (req, res) => {
  try {
    const workbook = XLSX.readFile(excelFile);
    const worksheet = workbook.Sheets['Users'];
    const data = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

    let html = `
      <h1>Ride Bookings</h1>
      <p><a href="/log">View Login Logs</a></p>
      <table border="1" cellpadding="5" cellspacing="0">
        <thead>
          <tr>
            <th>Phone</th>
            <th>Ride Time</th>
            <th>Pickup</th>
            <th>Destination</th>
            <th>Ride Type</th>
          </tr>
        </thead>
        <tbody>
    `;

    const bookings = data.filter(row => row.rideTime);

    if (bookings.length === 0) {
      html += `<tr><td colspan="5" style="text-align:center;">No bookings found.</td></tr>`;
    } else {
      bookings.forEach(entry => {
        html += `
          <tr>
            <td>${entry.phone}</td>
            <td>${entry.rideTime}</td>
            <td>${entry.pickup}</td>
            <td>${entry.destination}</td>
            <td>${entry.rideType}</td>
          </tr>
        `;
      });
    }

    html += `
        </tbody>
      </table>
    `;

    res.send(html);
  } catch (err) {
    console.error('Error reading Excel file:', err);
    res.status(500).send('Error reading Excel file.');
  }
});

// Download Excel file (password protected)
app.get('/download', auth, (req, res) => {
  res.download(excelFile, 'data.xlsx');
});

// View visitor IPs (password protected)
app.get('/ip', auth, (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(ipLogFile));

    let html = `
      <h1>Visitor IPs</h1>
      <p><a href="/log">View Login Logs</a> | <a href="/books">View Booking Logs</a></p>
      <table border="1" cellpadding="5" cellspacing="0">
        <tr><th>IP</th><th>Time</th></tr>
    `;

    if (data.length === 0) {
      html += `<tr><td colspan="2" style="text-align:center;">No IP logs found.</td></tr>`;
    } else {
      data.forEach(entry => {
        html += `<tr><td>${entry.ip}</td><td>${entry.time}</td></tr>`;
      });
    }

    html += `</table>`;
    res.send(html);
  } catch (err) {
    console.error('Failed to read IP log file:', err);
    res.status(500).send('Error reading IP log file.');
  }
});

// Log ride booking
app.post('/log-ride', (req, res) => {
  const { phone, pickup, destination, rideType } = req.body;
  if (!phone || !pickup || !destination || !rideType) {
    return res.status(400).json({ message: 'Missing required booking data' });
  }

  try {
    const workbook = XLSX.readFile(excelFile);
    const worksheet = workbook.Sheets['Users'];
    const data = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

    let lastIndex = -1;
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i].phone === phone) {
        lastIndex = i;
        break;
      }
    }

    const now = new Date().toISOString();

    if (lastIndex >= 0) {
      data[lastIndex].rideTime = now;
      data[lastIndex].pickup = pickup;
      data[lastIndex].destination = destination;
      data[lastIndex].rideType = rideType;
    } else {
      data.push({
        phone,
        rideTime: now,
        pickup,
        destination,
        rideType,
      });
    }

    const updatedWS = XLSX.utils.json_to_sheet(data);
    workbook.Sheets['Users'] = updatedWS;
    XLSX.writeFile(workbook, excelFile);

    res.json({ message: 'Ride logged successfully' });
  } catch (err) {
    console.error('Failed to log ride:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Catch-all route (serve index.html for SPA routes)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
