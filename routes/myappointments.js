const express = require('express');
const router = express.Router();
const db2 = require('../db2'); // Database connection/module

// Auth middleware: checks if user is logged in by verifying session
const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.user) {
    // If no user session, redirect to login page
    return res.redirect('/login');
  }
  next(); // User is authenticated, proceed to next middleware/handler
};

// Role checker middleware factory: checks if logged-in user has the required role
// Accepts multiple allowed roles as arguments
function requireRole(...allowedRoles) {
  return function (req, res, next) {
    // If user not logged in or user role is not in allowedRoles, deny access
    if (!req.session.user || !allowedRoles.includes(req.session.user.role)) {
      return res.status(403).send('Access denied.');
    }
    next(); // Role authorized, proceed
  };
}

// Route to assign a mechanic to an appointment
// Protected by authentication and requires user role 'SUPERVISOR'
router.post('/assign/:appointmentId', requireAuth, requireRole('SUPERVISOR'), (req, res) => {
  const { appointmentId } = req.params; // Get appointment ID from URL params
  const { MechanicAssigned } = req.body; // Get mechanic ID from POST body

  // Step 1: Verify that the assigned user is actually a mechanic
  const checkMechanicQuery = `SELECT * FROM user WHERE UserID = ? AND UserType = 'MECHANIC'`;
  db2.get(checkMechanicQuery, [MechanicAssigned], (err, userRow) => {
    if (err) {
      console.error(err);
       res.redirect(`/myappointments?error=Database Error while checking Mechanic`);
    }

    if (!userRow) {
      // If no such mechanic found, return error
       res.redirect(`/myappointments?error=No Such Mechanic`);
    }

    // Step 2: Update the appointment to assign the mechanic
    const updateQuery = `UPDATE appointment SET MechanicAssigned = ? WHERE AppointmentID = ?`;
    db2.run(updateQuery, [MechanicAssigned, appointmentId], function (err) {
      if (err) {
        console.error(err);
          res.redirect(`/myappointments?error=Failed To Update Mechanic`);;
      }
      // On success, redirect user to their appointments page
      res.redirect('/myappointments');
    });
  });
});

// Route to get all appointments related to the logged-in user
router.get('/', requireAuth, (req, res) => {
  const user = req.session.user; // Logged-in user info from session

  // Check if user has a privileged role (can see all appointments)
  const isPrivileged = user.role === 'ADMIN' || user.role === 'MECHANIC' || user.role === 'SUPERVISOR';

  // Query for cleaning appointments joined with user, vehicle, and mechanic info
  const cleanQuery = `
    SELECT a.AppointmentID, a.AppointmentDate, a.TimeSlot, a.Location, a.AppointmentStatus, a.MechanicAssigned,
           c.CleanType, v.Registration, v.Make, v.Model,
           m.FirstName || ' ' || m.LastName AS MechanicName,
           u.FirstName AS CustomerFirstName,
           u.LastName AS CustomerLastName
    FROM clean c
    JOIN appointment a ON c.AppointmentID = a.AppointmentID
    JOIN vehicle v ON c.Registration = v.Registration
    LEFT JOIN user m ON a.MechanicAssigned = m.UserID
    JOIN user u ON a.UserID = u.UserID
    ${isPrivileged ? '' : 'WHERE a.UserID = ?'}  -- If not privileged, filter by user ID only
    ORDER BY a.AppointmentDate ASC, a.TimeSlot ASC
  `;

  // Similar query for repair appointments
  const repairQuery = `
    SELECT a.AppointmentID, a.AppointmentDate, a.TimeSlot, a.Location, a.AppointmentStatus, a.MechanicAssigned,
           r.RepairType, r.SpecificRepairs, v.Registration, v.Make, v.Model,
           m.FirstName || ' ' || m.LastName AS MechanicName,
           u.FirstName AS CustomerFirstName,
           u.LastName AS CustomerLastName
    FROM repair r
    JOIN appointment a ON r.AppointmentID = a.AppointmentID
    JOIN vehicle v ON r.Registration = v.Registration
    LEFT JOIN user m ON a.MechanicAssigned = m.UserID
    JOIN user u ON a.UserID = u.UserID
    ${isPrivileged ? '' : 'WHERE a.UserID = ?'}
    ORDER BY a.AppointmentDate ASC, a.TimeSlot ASC
  `;

  // Similar query for service appointments
  const serviceQuery = `
    SELECT a.AppointmentID, a.AppointmentDate, a.TimeSlot, a.Location, a.AppointmentStatus, a.MechanicAssigned,
           s.ServiceType, s.SpecificService, s.OdometerKM, s.LogbookInterval,
           v.Registration, v.Make, v.Model,
           m.FirstName || ' ' || m.LastName AS MechanicName,
           u.FirstName AS CustomerFirstName,
           u.LastName AS CustomerLastName
    FROM service s
    JOIN appointment a ON s.AppointmentID = a.AppointmentID
    JOIN vehicle v ON s.Registration = v.Registration
    LEFT JOIN user m ON a.MechanicAssigned = m.UserID
    JOIN user u ON a.UserID = u.UserID
    ${isPrivileged ? '' : 'WHERE a.UserID = ?'}
    ORDER BY a.AppointmentDate ASC, a.TimeSlot ASC
  `;

  // If user is privileged, no params needed, else pass user ID as param for filtering
  const param = isPrivileged ? [] : [user.id];

  // Query cleaning appointments
  db2.all(cleanQuery, param, (err, cleanAppointments) => {
    if (err)  res.redirect(`/myappointments?error=Error Fetching Repair Appointments`);;

    // Query repair appointments
    db2.all(repairQuery, param, (err, repairAppointments) => {
      if (err)  res.redirect(`/myappointments?error=Error Fetching Cleaning Appointments`);;

      // Query service appointments
      db2.all(serviceQuery, param, (err, serviceAppointments) => {
        if (err)  res.redirect(`/myappointments?error=Email Fetching Servicing Appointments`);

        // Render 'myappointments' view with all three appointment types and user info
        res.render('myappointments', {
          user,
          cleanAppointments,
          repairAppointments,
          serviceAppointments,
          success: req.query.success, error: req.query.error
        });
      });
    });
  });
});

module.exports = router;
