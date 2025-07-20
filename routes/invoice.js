const express = require('express');
const router = express.Router();
const db = require('../db2'); // Database connection
const fs = require('fs');
const path = require('path');
const os = require('os');
const ejs = require('ejs'); // Templating engine for rendering HTML
const pdf = require('html-pdf'); // Library to generate PDF from HTML
const nodemailer = require('nodemailer'); // For sending emails
require('dotenv').config(); // Load environment variables from .env file

// Helper function to resolve asset paths depending on running environment (pkg or dev)
function getAssetPath(relativePath) {
  if (process.pkg) {
    // If packaged as an executable with pkg, assets are relative to exec path
    return path.join(path.dirname(process.execPath), relativePath);
  } else {
    // If running in development environment, assets relative to this file
    return path.join(__dirname, '..', relativePath);
  }
}

// Dynamically get the path to PhantomJS binary depending on platform and environment
function getPhantomPath() {
  const phantomFileName = process.platform === 'win32' ? 'phantomjs.exe' : 'phantomjs';

  if (process.pkg) {
    // When packaged with pkg, extract PhantomJS binary to temp directory
    const tmp = os.tmpdir();
    const phantomTmpPath = path.join(tmp, phantomFileName);

    if (!fs.existsSync(phantomTmpPath)) {
      // Read phantom binary from packaged binary and write to temp
      const phantomBinaryPath = path.join(path.dirname(process.execPath), 'bin', phantomFileName);
      const phantomBinary = fs.readFileSync(phantomBinaryPath);
      fs.writeFileSync(phantomTmpPath, phantomBinary, { mode: 0o755 }); // Make executable
    }

    return phantomTmpPath;
  } else {
    // Local dev environment path to PhantomJS binary
    return path.join(__dirname, '..', 'bin', phantomFileName);
  }
}

// Extract the html-pdf script to temp location if not already extracted (needed for pkg)
function extractHtmlPdfScript() {
  const tmp = os.tmpdir();
  const scriptPath = path.join(tmp, 'pdf_a4_portrait.js');

  if (!fs.existsSync(scriptPath)) {
    const localScriptPath = path.join(__dirname, '../node_modules/html-pdf/lib/scripts/pdf_a4_portrait.js');
    const scriptSource = fs.readFileSync(localScriptPath, 'utf8');
    fs.writeFileSync(scriptPath, scriptSource, 'utf8');
  }

  return scriptPath;
}

// Configuration options for html-pdf
const pdfOptions = {
  phantomPath: getPhantomPath(),    // Use dynamically resolved PhantomJS binary
  script: extractHtmlPdfScript(),   // Use extracted script for pdf layout
  format: 'A4',
  orientation: 'portrait',
  type: 'pdf',
  border: '10mm'
};

// Load company logo as base64 data URL to embed in invoices
const logoPath = getAssetPath('public/amw-logo-1.png');
const logoBase64 = fs.readFileSync(logoPath, 'base64');
const logoDataURL = `data:image/png;base64,${logoBase64}`;

// Path to the EJS invoice template
const templatePath = path.resolve(__dirname, '../views/invoice-template.ejs');

// Load pricing information from JSON file
const prices = JSON.parse(fs.readFileSync(path.join(__dirname, '../prices.json')));

// Configure nodemailer transporter using Gmail SMTP and credentials from env
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Authentication middleware to protect routes
const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/login'); // Redirect unauthenticated users to login
  }
  next();
};

// Role-based access control middleware for a single required role
function requireRole(role) {
  return function (req, res, next) {
    if (!req.session.user || req.session.user.role !== role) {
      return res.status(403).send('Access denied.');
    }
    next();
  };
}

// Route to generate and email invoice PDF for a specific appointment (ADMIN only)
router.get('/:appointmentId', requireAuth, requireRole('ADMIN'), (req, res) => {
  const appointmentId = req.params.appointmentId;

  // Query to get appointment details with related user and vehicle info
  db.get(`
    SELECT a.*, u.FirstName, u.LastName, u.EmailAddress, v.Make, v.Model, v.Year, v.Registration
    FROM appointment a
    JOIN user u ON a.UserID = u.UserID
    JOIN vehicle v ON a.Registration = v.Registration
    WHERE a.AppointmentID = ?
  `, [appointmentId], (err, appointment) => {
    if (err || !appointment) {
      // Appointment not found or query error
return res.redirect('/myappointments?error=' + encodeURIComponent('Appointment not found.'));
    }

    // Only allow invoice generation if appointment is completed
    if (appointment.AppointmentStatus !== 'Completed') {
      return res.redirect('/myappointments?error=' + encodeURIComponent('Invoice can only be sent for completed appointments.'));

    }

    // Prepare invoice object with customer and vehicle details, and empty items list
    const invoice = {
      customerName: `${appointment.FirstName} ${appointment.LastName}`,
      email: appointment.EmailAddress,
      vehicle: `${appointment.Make} ${appointment.Model} (${appointment.Year}) - ${appointment.Registration}`,
      date: appointment.AppointmentDate,
      time: appointment.TimeSlot,
      location: appointment.Location,
      items: [],
      total: 0,
      logo: logoDataURL
    };

    // Helper to add cleaning details to invoice if any
    const addClean = () => new Promise(resolve => {
      db.get(`SELECT * FROM clean WHERE AppointmentID = ?`, [appointmentId], (err, clean) => {
        if (clean) {
          const type = clean.CleanType.toLowerCase();
          const cost = prices.clean[type] || 0;
          invoice.items.push({ type: 'Cleaning', detail: clean.CleanType, cost });
          invoice.total += cost;
        }
        resolve();
      });
    });

    // Helper to add repair details to invoice if any
    const addRepair = () => new Promise(resolve => {
      db.get(`SELECT * FROM repair WHERE AppointmentID = ?`, [appointmentId], (err, repair) => {
        if (repair) {
          const type = repair.RepairType.toLowerCase();
          const cost = prices.repair[type] || 0;
          invoice.items.push({ type: 'Repair', detail: repair.RepairType, cost });
          invoice.total += cost;
        }
        resolve();
      });
    });

    // Helper to add service details to invoice if any
    const addService = () => new Promise(resolve => {
      db.get(`SELECT * FROM service WHERE AppointmentID = ?`, [appointmentId], (err, service) => {
        if (service) {
          const type = service.ServiceType.toLowerCase();
          const cost = prices.service[type] || 0;
          invoice.items.push({ type: 'Service', detail: service.ServiceType, cost });
          invoice.total += cost;
        }
        resolve();
      });
    });

    // After gathering all service, repair, and cleaning info
    Promise.all([addService(), addRepair(), addClean()]).then(() => {
      // Render invoice HTML from EJS template and invoice data
      ejs.renderFile(path.join(__dirname, '../views/invoice-template.ejs'), invoice, (err, html) => {
        if (err) return res.status(500).json({ error: 'Failed to render invoice.' });

        // Format appointment date and time into a string for filename
        const [hour, minute] = appointment.TimeSlot.split(':').map(Number);
        const appointmentDateTime = new Date(appointment.AppointmentDate);
        appointmentDateTime.setHours(hour);
        appointmentDateTime.setMinutes(minute);
        appointmentDateTime.setSeconds(0);
        const pad = n => n.toString().padStart(2, '0');
        const formattedDate = 
          `${appointmentDateTime.getFullYear()}${pad(appointmentDateTime.getMonth() + 1)}${pad(appointmentDateTime.getDate())}` +
          `${pad(appointmentDateTime.getHours())}${pad(appointmentDateTime.getMinutes())}`;

        // Generate filename by combining formatted date and customer name (no spaces)
        const customerName = `${appointment.FirstName}${appointment.LastName}`.replace(/\s+/g, '');
        const filename = `${formattedDate} ${customerName}.pdf`;

        // Use temp directory to write PDF file safely
        const pdfPath = path.join(os.tmpdir(), filename);

        // Create PDF from HTML and save to file
        pdf.create(html, pdfOptions).toFile(pdfPath, (err, result) => {
          if (err) {
            console.error('PDF generation error:', err);
            res.redirect(`/myappointments?error=Invoice failed: ${encodeURIComponent('PDF generation error')}`);

          }

          // Configure email with PDF invoice attachment
          const mailOptions = {
            from: 'yourcompanyemail@gmail.com',  // Replace with your sender email
            to: invoice.email,
            subject: 'Your AMW Appointment Invoice',
            text: 'Attached is the invoice for your recent appointment.',
            attachments: [{ filename: filename, path: result.filename }]
          };

          // Send invoice email
          transporter.sendMail(mailOptions, (err, info) => {
            if (err)  res.redirect(`/myappointments?error=Email Failed To Send`);;
           


            // Delete the temporary PDF file after sending email
            fs.unlink(result.filename, err => {
              if (err) console.warn('Could not delete temp PDF:', err);
            });

            // Respond with success message and info about invoice path
            // res.json({ success: true, message: 'Invoice emailed to customer.', invoicePath: result.filename });
            res.redirect(`/myappointments?success=Invoice sent to ${invoice.customerName}`);


          });
        });
      });
    });
  });
});

module.exports = router;
