const express = require('express');
const router = express.Router();
const db2 = require('../db2'); // Database module/connection

// Middleware to check if the user is authenticated (logged in)
const requireAuth = (req, res, next) => {
  // If no session or no user in session, redirect to login page
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  next(); // User is authenticated, proceed
};

// Middleware factory for role-based access control
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

// GET /mycustomers route to list customers and their vehicles
// Accessible to ADMIN, SUPERVISOR, and MECHANIC roles
router.get('/', requireAuth, requireRole('ADMIN', 'SUPERVISOR', 'MECHANIC'), (req, res) => {
  // SQL query to get customer info joined with their vehicles (if any)
  const sql = `
    SELECT u.UserID, u.FirstName, u.LastName, u.EmailAddress, u.PhoneNumber, 
           v.Registration, v.Make, v.Model, v.Year, v.Colour
    FROM user u
    LEFT JOIN vehicle v ON u.UserID = v.UserID
    WHERE u.UserType = 'CUSTOMER' -- only customers, no other user types
    ORDER BY u.UserID
  `;

  db2.all(sql, [], (err, rows) => {
    if (err) return res.status(500).send("Error loading customers");

    // Transform flat rows into a structured object grouping vehicles by customer
    const customers = {};
    rows.forEach(row => {
      if (!customers[row.UserID]) {
        // Initialize customer object if not already created
        customers[row.UserID] = {
          UserID: row.UserID,
          FirstName: row.FirstName,
          LastName: row.LastName,
          EmailAddress: row.EmailAddress,
          PhoneNumber: row.PhoneNumber,
          Vehicles: [] // array to hold this customer's vehicles
        };
      }

      // If vehicle info exists, push vehicle details into the customer's Vehicles array
      if (row.Registration) {
        customers[row.UserID].Vehicles.push({
          Registration: row.Registration,
          Make: row.Make,
          Model: row.Model,
          Year: row.Year,
          Colour: row.Colour
        });
      }
    });

    // Render the 'mycustomers' template/view
    // Pass the customers as an array (values of the customers object),
    // current logged-in user info, and optional 'deleted' query param for UI feedback
    res.render('mycustomers', {
      customers: Object.values(customers),
      user: req.session.user,
      deleted: req.query.deleted
    });
  });
});

// POST route to add a new vehicle to a customer
// Restricted to ADMIN role only
router.post('/add-vehicle', requireAuth, requireRole('ADMIN'), (req, res) => {
  const { userId, registration, make, model, year, colour } = req.body;
  // Set lastServiceDate to today's date in YYYY-MM-DD format
  const lastServiceDate = new Date().toISOString().split('T')[0];

  // Insert new vehicle into the vehicle table
  db2.run(`
    INSERT INTO vehicle (Registration, UserID, Make, Model, Year, Colour, LastServiceDate)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [registration, userId, make, model, year, colour, lastServiceDate], function(err) {
    if (err) {
      console.error(err);
      // Possibly due to duplicate registration or other DB constraint
      return res.status(500).send("Failed to add vehicle. Registration may be taken");
    }
    // On success, redirect back to the customers page
    res.redirect('/mycustomers');
  });
});

// POST route to delete a vehicle by its registration
// Restricted to ADMIN role only
router.post('/delete-vehicle', requireAuth, requireRole('ADMIN'), (req, res) => {
  const registration = req.body.registration;

  // Delete vehicle from the vehicle table where Registration matches
  db2.run('DELETE FROM vehicle WHERE Registration = ?', [registration], function(err) {
    if (err) {
      console.error('Error deleting vehicle:', err.message);
      return res.status(500).send('Error deleting vehicle.');
    }
    // Redirect with query parameter to signal deletion success (for UI feedback)
    res.redirect('/mycustomers?deleted=1');
  });
});

module.exports = router;
