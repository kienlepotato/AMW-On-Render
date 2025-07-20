const express = require('express');
const router = express.Router();
const db2 = require('../db2'); // Database connection/module

// Middleware to check if user is authenticated (logged in)
function requireAuth(req, res, next) {
  // If no logged-in user, redirect to login page
  if (!req.session.user) return res.redirect('/login');
  next(); // User authenticated, continue
}

// Middleware factory for role-based access control
// Only allows users with specified roles to proceed
function requireRole(...allowedRoles) {
  return function (req, res, next) {
    // If no user or user's role is not allowed, deny access with message
    if (!req.session.user || !allowedRoles.includes(req.session.user.role)) {
      return  res.redirect('/services?error=Access Denied. Vehicles page only available to Customers');
    }
    next(); // User role authorized, continue
  };
}

// Route: GET /
// View all vehicles for the logged-in customer
router.get('/', requireAuth, requireRole('CUSTOMER'), (req, res) => {
  const userId = req.session.user.id; // Get current user ID
  const sql = `SELECT * FROM vehicle WHERE UserID = ?`; // Select vehicles belonging to user

  // Query database for vehicles owned by user
  db2.all(sql, [userId], (err, vehicles) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Database error.');
    }

    const error = req.query.error || null; // Get any error query param
    // Render the 'myvehicles' view with vehicles list and user info
    res.render('myvehicles', { user: req.session.user, vehicles, error });
  });
});

// Route: POST /add
// Add a new vehicle for the logged-in customer
// Checks that the vehicle registration is unique before inserting
router.post('/add', requireAuth, requireRole('CUSTOMER'), (req, res) => {
  const { registration, make, model, year, colour, lastservicedate } = req.body;
  const userId = req.session.user.id;

  // Check if vehicle registration already exists in DB
  const checkSql = `SELECT * FROM vehicle WHERE Registration = ?`;
  db2.get(checkSql, [registration], (err, existingVehicle) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Database error (vehicle check).");
    }

    // If registration already used, deny insertion
    if (existingVehicle) {
      return res.status(403).send("Vehicle registration already in use.");
    }

    // Insert new vehicle record since registration is unique
    const insertSql = `
      INSERT INTO vehicle (Registration, UserID, Make, Model, Year, Colour, LastServiceDate)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    db2.run(insertSql, [registration, userId, make, model, year, colour, lastservicedate], function (err) {
      if (err) {
        console.error(err);
        return res.status(500).send("Failed to add vehicle.");
      }
      res.redirect('/myvehicles'); // Redirect back to vehicle list after success
    });
  });
});

// Route: GET /edit/:registration
// Show form to edit a vehicle's details by registration number
router.get('/edit/:registration', requireAuth, requireRole('CUSTOMER'), (req, res) => {
  const rego = req.params.registration;
  const sql = `SELECT * FROM vehicle WHERE Registration = ?`;

  // Fetch vehicle details from DB
  db2.get(sql, [rego], (err, vehicle) => {
    if (err || !vehicle) {
      console.error(err);
      return res.status(404).send('Vehicle not found.');
    }
    // Render edit form, passing vehicle data and user info
    res.render('editvehicle', { user: req.session.user, vehicle, error: null });
  });
});

// Route: POST /edit/:registration
// Handle submission of edited vehicle details
router.post('/edit/:registration', requireAuth, (req, res) => {
  const oldReg = req.params.registration;
  const { make, model, year, colour, lastservicedate } = req.body;

  const sql = `
    UPDATE vehicle
    SET Make = ?, Model = ?, Year = ?, Colour = ?, LastServiceDate = ?
    WHERE Registration = ?
  `;

  // Update vehicle in DB by registration number
  db2.run(sql, [make, model, year, colour, lastservicedate, oldReg], function (err) {
    if (err) {
      console.error(err);
      return res.status(500).send('Update failed.');
    }
    res.redirect('/myvehicles'); // Redirect to vehicle list after update
  });
});

// Route: POST /update/:registration
// Another route for updating vehicle info with extra check for customer ownership
router.post('/update/:registration', requireAuth, requireRole('CUSTOMER'), (req, res) => {
  const reg = req.params.registration;
  const { make, model, year, colour, lastservicedate } = req.body;

  const sql = `
    UPDATE vehicle
    SET Make = ?, Model = ?, Year = ?, Colour = ?, LastServiceDate = ?
    WHERE Registration = ? AND UserID = ?
  `;

  // Update only if vehicle belongs to the logged-in user
  db2.run(sql, [make, model, year, colour, lastservicedate, reg, req.session.user.id], function (err) {
    if (err) {
      console.error(err);
    }
    res.redirect('/myvehicles'); // Redirect after update
  });
});

// Route: POST /delete/:registration
// Delete a vehicle owned by the logged-in customer
router.post('/delete/:registration', requireAuth, requireRole('CUSTOMER'), (req, res) => {
  const reg = req.params.registration;
  const sql = `DELETE FROM vehicle WHERE Registration = ? AND UserID = ?`;

  // Delete vehicle only if it belongs to user
  db2.run(sql, [reg, req.session.user.id], function (err) {
    if (err) {
      console.error(err);
    }
    res.redirect('/myvehicles'); // Redirect after deletion
  });
});

module.exports = router;
