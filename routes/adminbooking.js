// Import required modules
const express = require('express');
const router = express.Router();
const db = require('../db2'); // Database connection

const path = require('path');
// Load public holiday dates from JSON file
const publicHolidays = require('../publicHolidays.json');

const { promisify } = require('util');
// Promisify db.run to use with async/await (not currently used, but can be helpful)
const dbRun = promisify(db.run.bind(db));

// ------------------------
// Middleware for Access Control
// ------------------------

// Ensure user is authenticated
const requireAuth = (req, res, next) => {
  if (!req.session?.user) return res.redirect('/login');
  next();
};

// Ensure user has specific role (ADMIN)
const requireRole = role => (req, res, next) => {
  if (req.session.user.role !== role) return res.status(403).send('Access denied.');
  next();
};

// ------------------------
// Helper Function to Render Admin Booking Page with Customer List
// ------------------------
function renderAdminBookingWithCustomers(req, res, options) {
  db.all(`SELECT UserID, FirstName, LastName FROM user WHERE UserType = 'CUSTOMER'`, [], (err, customers) => {
    if (err) {
      return res.status(500).send("Failed to load customers.");
    }
    res.render('adminbooking', {
      user: req.session.user,
      success: options.success || null,
      error: options.error || null,
      customers
    });
  });
}

// ------------------------
// GET: Admin Booking Page
// ------------------------
router.get('/', requireAuth, requireRole('ADMIN'), (req, res) => {
  db.all(`SELECT UserID, FirstName, LastName FROM user WHERE UserType = 'CUSTOMER'`, [], (err, customers) => {
    if (err) return res.status(500).send("Failed to load customers.");
    res.render('adminbooking', {
      user: req.session.user,
      success: req.query.success || null,
      error: null,
      customers: customers || []
    });
  });
});

// ------------------------
// POST: Create New Appointment
// ------------------------
router.post('/', requireAuth, requireRole('ADMIN'), async (req, res) => {
  let customers; // shared scope for use in error rendering

  // Extract form input
  const {
    customerId, registration, appointmentDate, appointmentTime,
    repairType, serviceType, servicingType, cleanType,
    specificRepairs, specificDetails, odometer, logbookInterval,
    location
  } = req.body;

  const datetime = `${appointmentDate} ${appointmentTime}`;

  // ------------------------
  // Input Validation
  // ------------------------

  // Ensure selected date is in the future
  const customDate = new Date(appointmentDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalize today's date to midnight

  if (customDate < today) {
    return renderAdminBookingWithCustomers(req, res, {
      error: 'Invalid time slot selected. Must Choose Future Date'
    });
  }

  // Validate appointment time is during business hours (07:00–17:00)
  const [hour, minute] = appointmentTime.split(":").map(Number);
  if (hour < 7 || hour > 17 || (hour === 17 && minute > 0)) {
    return renderAdminBookingWithCustomers(req, res, {
      error: 'Appointment time must be within business hours (8:00–18:00).'
    });
  }

  // Only allow specific time slots (e.g. every 30 mins)
  const validTimeSlots = [
    "08:00", "09:00", "10:00", "11:00",
    "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", 
    "08:30", "09:30", "10:30", "11:30",
    "12:30", "13:30", "14:30", "15:30", "16:30", "17:30"
  ];
  if (!validTimeSlots.includes(appointmentTime)) {
    return renderAdminBookingWithCustomers(req, res, {
      error: 'Invalid time slot selected.'
    });
  }

  // Prevent bookings on public holidays
  const formattedDate = appointmentDate.split("T")[0]; // YYYY-MM-DD
  if (publicHolidays.includes(formattedDate)) {
    return renderAdminBookingWithCustomers(req, res, {
      error: 'Cannot Book During Public Holidays'
    });
  }

  // Prevent triple bookings for same location and time
  const bookingCount = await new Promise((resolve, reject) => {
    db.get(
      `SELECT COUNT(*) AS count FROM appointment WHERE AppointmentDate = ? AND TimeSlot = ? AND Location = ?`,
      [appointmentDate, appointmentTime, location],
      (err, row) => {
        if (err) return reject(err);
        resolve(row.count);
      }
    );
  });

  if (bookingCount >= 3) {
    return renderAdminBookingWithCustomers(req, res, {
      error: 'Location and Time Slot Already At Full Capacity.'
    });
  }

  // ------------------------
  // Insert Appointment
  // ------------------------

  db.run(`
    INSERT INTO appointment (UserID, Registration, AppointmentDate, TimeSlot, Location, AppointmentStatus)
    VALUES (?, ?, ?, ?, ?, 'SCHEDULED')
  `, [customerId, registration, appointmentDate, appointmentTime, location], function(err) {
    if (err) {
      return renderAdminBookingWithCustomers(req, res, {
        error: 'Unable To Create Appointment. Check Registration is Correct.'
      });
    }

    const appointmentId = this.lastID;

    // Insert into appropriate service table depending on type

    // CLEAN service
    if (serviceType === 'CLEAN') {
      db.run(`INSERT INTO clean (AppointmentID, Registration, CleanType) VALUES (?, ?, ?)`,
        [appointmentId, registration, cleanType], err => {
          if (err) {
            return renderAdminBookingWithCustomers(req, res, {
              error: 'Unable To Book Cleaning. Check Registration is Correct.'
            });
          }
          res.redirect('/adminbooking?success=1');
        });

    // REPAIR service
    } else if (serviceType === 'REPAIR') {
      db.run(`INSERT INTO repair (AppointmentID, Registration, RepairType, SpecificRepairs) VALUES (?, ?, ?, ?)`,
        [appointmentId, registration, repairType, specificRepairs], err => {
          if (err) {
            return renderAdminBookingWithCustomers(req, res, {
              error: 'Unable To Book Repair. Check Registration is Correct.'
            });
          }
          res.redirect('/adminbooking?success=1');
        });

    // GENERAL SERVICE
    } else if (serviceType === 'SERVICE') {
      db.run(`INSERT INTO service (AppointmentID, Registration, OdometerKM, LogbookInterval, ServiceType, SpecificService)
              VALUES (?, ?, ?, ?, ?, ?)`,
        [appointmentId, registration, odometer, logbookInterval, servicingType, specificDetails], err => {
          if (err) {
            return renderAdminBookingWithCustomers(req, res, {
              error: 'Unable To Book Service. Check Registration is Correct.'
            });
          }
          res.redirect('/adminbooking?success=1');
        });

    // Unknown service type
    } else {
      return renderAdminBookingWithCustomers(req, res, {
        error: 'Invalid Service.'
      });
    }
  });
});

// Export the router for use in main server file
module.exports = router;
