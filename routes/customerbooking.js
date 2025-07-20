const express = require('express');
const router = express.Router();
const db = require('../db2');

const path = require('path');
// const publicHolidays = require(path.join(__dirname, '../publicHolidays.json'));
const publicHolidays = require('../publicHolidays.json');

const { promisify } = require('util');
// Promisify db.run for async/await usage
const dbRun = promisify(db.run.bind(db));

// Middleware to parse URL-encoded form data (needed to get form fields from POST requests)
router.use(express.urlencoded({ extended: true }));

// Middleware: Require that user is logged in (has a session user)
const requireAuth = (req, res, next) => {
  if (!req.session?.user) return res.redirect('/login');
  next();
};

// Middleware: Require that user has a specific role, e.g. 'CUSTOMER'
const requireRole = role => (req, res, next) => {
  if (req.session.user.role !== role) return res.redirect('/services?error=Access Denied. Booking page only available to Customers');
  next();
};

// GET booking form for customer, only accessible if authenticated and role is CUSTOMER
router.get('/', requireAuth, requireRole('CUSTOMER'), (req, res) => {
  res.render('customerbooking', { user: req.session.user,
    query: req.query, success: req.query.success, error: req.query.error });
});

// POST booking form submission for customer, with authentication and role check
router.post('/', requireAuth, requireRole('CUSTOMER'), async (req, res) => {
  // Extract all fields sent from the form in req.body
  const {
    registration,
    appointmentDate,
    appointmentTime,
    repairType,
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

  // Get logged-in user's ID from session (to associate appointment with user)
  const customerId = req.session.user.id;

  // Validate the appointment date is not in the past
  const customDate = new Date(appointmentDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalize today's date to midnight for comparison

if (customDate < today) {
return res.redirect('/customerbooking?error=Appointment Date Must Be In The Future');

  
}

// Validate time is within operating hours (7:00 to 17:00)
const [hour, minute] = appointmentTime.split(":").map(Number);
if (hour < 7 || hour > 17 || (hour === 17 && minute > 0)) {
  return res.redirect('/customerbooking?error=Appointment time must be within business hours (8:00–18:00');
}

  // Validate the appointment time is one of the allowed time slots
  const validTimeSlots = [
    "08:00", "09:00", "10:00", "11:00",
    "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", 
    "08:30", "09:30", "10:30", "11:30",
    "12:30", "13:30", "14:30", "15:30", "16:30", "17:30"
  ];

if (!validTimeSlots.includes(appointmentTime)) {
  return res.redirect('/customerbooking?error=Invalid Time Slot');

}

// Example public holidays (add more as needed)
const formattedDate = appointmentDate.split("T")[0]; // ensures only date part
if (publicHolidays.includes(formattedDate)) {
  return res.redirect('/customerbooking?error=Cannot Book On Public Holiday');
}

// Check for triple booking
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
    return res.redirect('/customerbooking?error=This time slot and location has already reached full capacity. Please select anothe time or location');
}


//

  if (bookingCount >= 3) {
    return res.status(409).send("This time slot and location has already reached full capacity. Please select another time or location.");
  }

  try {
    // Insert the main appointment record in appointment table
    const result = await dbRun(`
      INSERT INTO appointment (UserID, Registration, AppointmentDate, TimeSlot, Location, AppointmentStatus)
      VALUES (?, ?, ?, ?, ?, 'SCHEDULED')
    `, [customerId, registration, appointmentDate, appointmentTime, location]);

    // SQLite doesn't return the last inserted ID from dbRun, so query for it
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT last_insert_rowid() AS id', (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    // Store the inserted appointment's ID for related inserts
    const appointmentId = row.id;

    // Insert into 'clean' table if the appointment type includes cleaning
    if (appointmentTypeC === 'cleaning') {
      await dbRun(
        `INSERT INTO clean (AppointmentID, Registration, CleanType) VALUES (?, ?, ?)`,
        [appointmentId, registration, cleanType]
      );
    }

    // Insert into 'repair' table if the appointment type includes repair
    if (appointmentTypeR === 'repair') {
      await dbRun(
        `INSERT INTO repair (AppointmentID, Registration, RepairType, SpecificRepairs) VALUES (?, ?, ?, ?)`,
        [appointmentId, registration, repairType, specificRepairs]
      );
    }

    // Insert into 'service' table if the appointment type includes service
    if (appointmentTypeS === 'service') {
      if (servicingType === 'specific') {
        // Handle specific services, including 'other' where user can specify details
        const specificService = specificDetails === 'other' ? specificOther : specificDetails;
        await dbRun(
          `INSERT INTO service (AppointmentID, Registration, OdometerKM, LogbookInterval, ServiceType, SpecificService)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [appointmentId, registration, odometer, logbookInterval, servicingType, specificService]
        );
      } else {
        // Generic service without specific details
        await dbRun(
          `INSERT INTO service (AppointmentID, Registration, OdometerKM, LogbookInterval, ServiceType, SpecificService)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [appointmentId, registration, odometer, logbookInterval, servicingType, '']
        );
      }
    }

    // ✅ Redirect with success
    res.redirect('/customerbooking?success=Booking Successful!');

  } catch (err) {
    // Log and return error if booking failed (possibly vehicle not registered or DB error)
    console.error('Booking failed:', err);
        return res.redirect('/customerbooking?error=Failed to book appointment. Vehicle May Not Be Registered. Register Your Vehicle in My Vehicles page');

    
  }
});

// Export the router to use in main app
module.exports = router;
