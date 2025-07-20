const express = require('express');
const router = express.Router();
const db = require('../db2');

const { promisify } = require('util');
const dbRun = promisify(db.run.bind(db));


// Middleware to parse URL-encoded form data
router.use(express.urlencoded({ extended: true }));

// Middleware
const requireAuth = (req, res, next) => {
  if (!req.session?.user) return res.redirect('/login');
  next();
};

const requireRole = role => (req, res, next) => {
  if (req.session.user.role !== role) return res.status(403).send('Access denied.');
  next();
};

// GET booking form for customer
router.get('/', requireAuth, requireRole('CUSTOMER'), (req, res) => {
  res.render('customerbooking', { user: req.session.user });
});

// POST booking form submission for customer
router.post('/', requireAuth, requireRole('CUSTOMER'), async (req, res) => {
  const {
    registration,
    appointmentDate,
    appointmentTime,
    repairType,
    // serviceType,
    servicingType,
    cleanType,
    specificRepairs,
    specificDetails,
    specificOther,
    odometer,
    logbookInterval,
    location,
    appointmentTypeR,
    appointmentTypeS,
    appointmentTypeC
  } = req.body;

  const customerId = req.session.user.id;

  // const validTimeSlots = [
  //   "08:00", "09:00", "10:00", "11:00",
  //   "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"
  // ];

  // if (!validTimeSlots.includes(appointmentTime)) {
  //   return res.status(400).send("Invalid time slot selected.");
  // }

  db.run(`
    INSERT INTO appointment (UserID, Registration, AppointmentDate, TimeSlot, Location, AppointmentStatus)
    VALUES (?, ?, ?, ?, ?, 'SCHEDULED')
  `, [customerId, registration, appointmentDate, appointmentTime, location], function(err) {
console.log(`Details: ${customerId}, ${registration}, ${appointmentDate}, ${appointmentTime}, ${location}`);
    if (err) return res.status(500).send("Failed to create appointment.");

    const appointmentId = this.lastID;

    if (appointmentTypeC === 'cleaning') {
       db.run(`INSERT INTO clean (AppointmentID, Registration, CleanType) VALUES (?, ?, ?)`,
        [appointmentId, registration, cleanType], err => {
          if (err) return res.status(500).send("Failed to book cleaning.");
          // res.redirect('/customerbooking?success=1');
        });

    }  if (appointmentTypeR === 'repair') {
      db.run(`INSERT INTO repair (AppointmentID, Registration, RepairType, SpecificRepairs) VALUES (?, ?, ?, ?)`,
        [appointmentId, registration, repairType, specificRepairs], err => {
          if (err) return res.status(500).send("Failed to book repair.");
          // res.redirect('/customerbooking?success=1');
        });

    }  if (appointmentTypeS === 'service' && servicingType==='specific'&& specificDetails==='other') {
      db.run(`INSERT INTO service (AppointmentID, Registration, OdometerKM, LogbookInterval, ServiceType, SpecificService)
              VALUES (?, ?, ?, ?, ?, ?)`,
        [appointmentId, registration, odometer, logbookInterval, servicingType, specificOther], err => {
          if (err) return res.status(500).send("Failed to book service.");
        });

    } 
     if (appointmentTypeS === 'service' && servicingType==='specific' && specificDetails!=='other') {
      db.run(`INSERT INTO service (AppointmentID, Registration, OdometerKM, LogbookInterval, ServiceType, SpecificService)
              VALUES (?, ?, ?, ?, ?, ?)`,
        [appointmentId, registration, odometer, logbookInterval, servicingType, specificDetails], err => {
          if (err) return res.status(500).send("Failed to book service.");
        });

    } 
    
    if (appointmentTypeS === 'service' && servicingType!=='specific') {
      db.run(`INSERT INTO service (AppointmentID, Registration, OdometerKM, LogbookInterval, ServiceType, SpecificService)
              VALUES (?, ?, ?, ?, ?, '')`,
        [appointmentId, registration, odometer, logbookInterval, servicingType], err => {
          if (err) return res.status(500).send("Failed to book service.");
        });

    }else {
      console.log(`Details: ${appointmentId}, ${registration}, ${odometer}, ${logbookInterval}, ${servicingType},${specificDetails}`);

      res.status(400).send("Invalid service type.");
    }

  });
});

module.exports = router;
