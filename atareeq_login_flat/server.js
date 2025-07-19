const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const admin = require('firebase-admin');
const fs = require('fs');

// Firebase admin initialization
const serviceAccount = require('./firebase/serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Phone login verification
app.post('/verify-phone', async (req, res) => {
  const { idToken } = req.body;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    res.send(`Phone login successful. UID: ${decoded.uid}`);
  } catch (error) {
    res.status(401).send('Invalid phone verification.');
  }
});

// Email link login (request)
app.post('/send-email-link', async (req, res) => {
  const { email } = req.body;
  const actionCodeSettings = {
    url: 'http://localhost:3000/login/email',
    handleCodeInApp: true,
  };

  try {
    const link = await admin.auth().generateSignInWithEmailLink(email, actionCodeSettings);
    res.send(`Login link sent to ${email}: ${link}`);
  } catch (err) {
    res.status(500).send('Error sending login link.');
  }
});

// Home route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
