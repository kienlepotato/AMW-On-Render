const express = require('express');
const router = express.Router();
const db = require('../db2');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const pdf = require('html-pdf');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Absolute path to the logo image
// const logoPath = path.resolve(__dirname, '../public/amw-logo-1.png');

// const logoUrl = `file:///${logoPath.replace(/\\/g, '/')}`; // Convert for html-pdf on Windows
// const logoBase64 = fs.readFileSync(logoPath, 'base64');
// const logoDataURL = `data:image/png;base64,${logoBase64}`;

function getAssetPath(relativePath) {
  if (process.pkg) {
    // Running inside a pkg binary
    return path.join(path.dirname(process.execPath), relativePath);
  } else {
    // Running in dev environment
    return path.join(__dirname, '..', relativePath);
  }
}

const logoPath = getAssetPath('public/amw-logo-1.png');
const logoBase64 = fs.readFileSync(logoPath, 'base64');
const logoDataURL = `data:image/png;base64,${logoBase64}`;


// Path to EJS template
const templatePath = path.resolve(__dirname, '../views/invoice-template.ejs');

const prices = JSON.parse(fs.readFileSync(path.join(__dirname, '../prices.json')));

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

//Auth middleware here:
// Auth middleware
const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  next();
};

//Role Checker for implementing access control
function requireRole(role) {
  return function (req, res, next) {
    if (!req.session.user || req.session.user.role !== role) {
      return res.status(403).send('Access denied.');
    }
    next();
  };
}


router.get('/:appointmentId', requireAuth, requireRole('ADMIN'),  (req, res) => {
  const appointmentId = req.params.appointmentId;

  db.get(`
    SELECT a.*, u.FirstName, u.LastName, u.EmailAddress, v.Make, v.Model, v.Year, v.Registration
    FROM appointment a
    JOIN user u ON a.UserID = u.UserID
    JOIN vehicle v ON a.Registration = v.Registration
    WHERE a.AppointmentID = ?
  `, [appointmentId], (err, appointment) => {
    if (err || !appointment) return res.status(404).json({ error: 'Appointment not found.' });

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

    Promise.all([addService(), addRepair(), addClean()]).then(() => {
      ejs.renderFile(path.join(__dirname, '../views/invoice-template.ejs'), invoice, (err, html) => {
        if (err) return res.status(500).json({ error: 'Failed to render invoice.' });

         const [hour, minute] = appointment.TimeSlot.split(':').map(Number); // Ensure numeric values
         const appointmentDateTime = new Date(appointment.AppointmentDate);
         appointmentDateTime.setHours(hour);
         appointmentDateTime.setMinutes(minute);
         appointmentDateTime.setSeconds(0);
         const pad = n => n.toString().padStart(2, '0');
         const formattedDate = 
          `${appointmentDateTime.getFullYear()}${pad(appointmentDateTime.getMonth() + 1)}${pad(appointmentDateTime.getDate())}` +
          `${pad(appointmentDateTime.getHours())}${pad(appointmentDateTime.getMinutes())}`;

        const customerName = `${appointment.FirstName}${appointment.LastName}`.replace(/\s+/g, '');


        const filename = `${formattedDate} ${customerName}.pdf`;

        const pdfPath = path.join(__dirname, `../invoices/${filename}`);
        pdf.create(html).toFile(pdfPath, (err, result) => {
          if (err) return res.status(500).json({ error: 'PDF generation failed.' });

          // Send via email
          const mailOptions = {
            from: 'yourcompanyemail@gmail.com',
            to: invoice.email,
            subject: 'Your AMW Appointment Invoice',
            text: 'Attached is the invoice for your recent appointment.',
            attachments: [{ filename: filename, path: result.filename }]
          };

          transporter.sendMail(mailOptions, (err, info) => {
            if (err) return res.status(500).json({ error: 'Email failed to send.' });
            res.json({ success: true, message: 'Invoice emailed to customer.', invoicePath: result.filename });
          });
        });
      });
    });
  });
});

module.exports = router;
