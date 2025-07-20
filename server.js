// AMW Booking App - Server Setup
require('ejs');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const db = require('./db');
const db2 = require('./db2');
const nodemailer = require('nodemailer');
require('dotenv').config();
const path = require('path');

// Initialize Routes
const appointmentsRouter = require('./routes/appointments');
const cleanappointmentsRouter = require('./routes/cleanappointments');
const repairappointmentsRouter = require('./routes/repairappointments');
const serviceappointmentsRouter = require('./routes/serviceappointments');
const signupRouter = require('./routes/signup');
const myvehiclesRouter = require('./routes/myvehicles');
const myAppointmentsRouter = require('./routes/myappointments');
const invoiceRouter = require('./routes/invoice');
const myMechanicsRouter = require('./routes/mymechanics');
const myCustomersRoute = require('./routes/mycustomers');
const adminBookingRoute = require('./routes/adminbooking');
const adminAddUserRoute = require('./routes/adduser');
const adminDeleteUserRoute = require('./routes/deleteuser');
const customerBookingRoute = require('./routes/customerbooking');

// Initialize Express app
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

// Set views directory
app.use(session({
  secret: 'supersecretkey',
  resave: false,
  saveUninitialized: false
}));

// Email transporter setup (Gmail example)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Middleware to handle session and user authentication
const requireAuth = (req, res, next) => {
  if (!req.session.user || !req.session.mfaVerified) return res.redirect('/login');
  next();
};

// Role checker middleware factory: checks if logged-in user has the required role
// Takes allowed roles as arguments and returns middleware function
function requireRole(...allowedRoles) {
  return function (req, res, next) {
    // If no user session or user role is not in allowedRoles, deny access
    if (!req.session.user || !allowedRoles.includes(req.session.user.role)) {
      return res.status(403).send('Access denied.');
    }
    next(); // Role is allowed, proceed
  };
}



//helper function for mapping appointment IDs to customers
const getAppointmentDetails = (appointmentID) => {
  return new Promise((resolve, reject) => {
    db2.get(
      `SELECT a.AppointmentID, a.AppointmentDate, a.TimeSlot, u.EmailAddress, u.FirstName
       FROM appointment a
       JOIN user u ON a.UserID = u.UserID
       WHERE a.AppointmentID = ?`,
      [appointmentID],
      (err, row) => {
        if (err) return reject(err);
        if (!row) return reject(new Error('Appointment not found'));
        resolve(row);
      }
    );
  });
};



// Middleware to check user role
app.use('/appointments', appointmentsRouter);
app.use('/cleanappointments', cleanappointmentsRouter);
app.use('/repairappointments', repairappointmentsRouter);
app.use('/serviceappointments', serviceappointmentsRouter);
app.use('/signup', signupRouter);
app.use('/myvehicles', myvehiclesRouter);
app.use('/myappointments', myAppointmentsRouter);
app.use('/invoice', invoiceRouter);
app.use('/mymechanics', myMechanicsRouter);
app.use('/mycustomers', myCustomersRoute);
app.use('/adminbooking', adminBookingRoute);
app.use('/adduser', adminAddUserRoute);
app.use('/deleteuser', adminDeleteUserRoute);
app.use('/customerbooking', customerBookingRoute);


// Login page
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// Login + MFA step
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  db2.get(`SELECT * FROM user WHERE EmailAddress = ?`, [email], async (err, user) => {
    if (err) return res.status(500).send("Server error.");
    if (!user) return res.render('login', { error: 'Invalid credentials' });

    const passwordMatch = await bcrypt.compare(password, user.Password);
    if (!passwordMatch) return res.render('login', { error: 'Invalid credentials' });

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Save user info to session but not logged in yet
    req.session.user = {
      id: user.UserID,
      name: `${user.FirstName} ${user.LastName}`,
      firstname: user.FirstName,
      lastname: user.LastName,
      email: user.EmailAddress,
      phonenumber: user.PhoneNumber,
      role: user.UserType
    };
    req.session.mfaCode = code;

    // Send email with the code
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: user.EmailAddress,
      subject: 'Your MFA Code',
      text: `Your verification code is: ${code}`
    });

    res.redirect('/mfa');
  });
});

// MFA verification page
app.get('/mfa', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('mfa', { error: null });
});

// MFA verification step
app.post('/mfa', (req, res) => {
  const { code } = req.body;
  if (req.session.mfaCode === code) {
    req.session.mfaVerified = true;
    delete req.session.mfaCode;
    return res.redirect('/');
  } else {
    return res.render('mfa', { error: 'Invalid verification code' });
  }
});

// Logout route
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Routes that require login + MFA
app.get('/customerbooking', requireAuth,requireRole('CUSTOMER'), (req, res) => {
  res.render('customerbooking', { user: req.session.user });
});
// Routes for booking services
app.get('/bookservice', requireAuth,requireRole('CUSTOMER'), (req, res) => {
  res.render('bookservice', { user: req.session.user });
});
// Routes for booking cleaning
app.get('/bookclean', requireAuth,requireRole('CUSTOMER'), (req, res) => {
  res.render('bookclean', { user: req.session.user });
});
// Routes for booking repair
app.get('/bookrepair', requireAuth,requireRole('CUSTOMER'), (req, res) => {
  res.render('bookrepair', { user: req.session.user });
});
// Routes for viewing appointments
app.get('/myvehicles', requireAuth,requireRole('CUSTOMER'), (req, res) => {
  res.render('myvehicles', { user: req.session.user });
});
// Routes for viewing appointments
app.get('/myappointments', requireAuth, (req, res) => {
  res.render('myappointments', { user: req.session.user });
});
// Routes for viewing invoices
app.get('/mymechanics', requireAuth, (req, res) => {
  res.render('mymechanics', { user: req.session.user });
});
// Routes for viewing customers
app.get('/mycustomers', requireAuth, (req, res) => {
  res.render('mycustomers', { user: req.session.user });
});
// Routes for admin booking
app.get('/adminbooking', requireAuth, (req, res) => {
  res.render('adminbooking', { user: req.session.user });
});

// app.get('/adduser', requireAuth, (req, res) => {
//   res.render('adduser', { user: req.session.user });
// });
// Other routes
// app.get('/', (req, res) => {
//   res.sendFile(path.join(__dirname, 'views/newhome.html'));
// });

// Static pages
app.get('/', (req, res) => {
  res.render('home', { user: req.session.user });
});

app.get('/aboutus', (req, res) => {
  res.render('aboutus', { user: req.session.user });
});

app.get('/services', (req, res) => {
  res.render('services', { user: req.session.user,query: req.query, success: req.query.success, error: req.query.error  });
});

app.get('/contactus', (req, res) => {
  res.render('contactus', { user: req.session.user });
});


app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/signup.html'));
});

app.get('/backdoor', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/oops.html'));
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/appointment.html'));
});

// Password reset functionality
app.get('/forgot', (req, res) => {
  res.render('forgot', { error: null, success: null });
});
// Handle forgot password
app.post('/forgot', async (req, res) => {
  const { email } = req.body;
  // Validate email format
  db2.get('SELECT * FROM user WHERE EmailAddress = ?', [email], async (err, user) => {
    if (err) return res.status(500).send("Database error.");
    if (!user) return res.render('forgot', { error: "Email not found", success: null });

    const token = Math.random().toString(36).substring(2, 15); // Generate simple token
    const expiry = Date.now() + 3600000; // Token valid for 1 hour

    // Save token and expiry in session or temporary in-memory object
    req.session.resetToken = { email, token, expiry };
    // Send reset link via email
    const resetLink = `http://${req.headers.host}/reset/${token}`;

    await transporter.sendMail({
      to: email,
      from: process.env.EMAIL_USER,
      subject: 'AMW Password Reset',
      text: `To reset your password, click the following link:\n\n${resetLink}`
    });

    res.render('forgot', { error: null, success: "Reset link sent to your email." });
  });
});

// Password reset page
app.get('/reset/:token', (req, res) => {
  const { token } = req.params;
  const sessionToken = req.session.resetToken;

  if (!sessionToken || sessionToken.token !== token || sessionToken.expiry < Date.now()) {
    return res.send("Reset link is invalid or expired.");
  }

  res.render('reset', { token, error: null });
});

// Handle password reset
app.post('/reset/:token', async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;
  const sessionToken = req.session.resetToken;

  if (!sessionToken || sessionToken.token !== token || sessionToken.expiry < Date.now()) {
    return res.send("Reset link is invalid or expired.");
  }
  
  const hashedPassword = await bcrypt.hash(password, 10);
  // Update the user's password in the database
  db2.run(`UPDATE user SET Password = ? WHERE EmailAddress = ?`, [hashedPassword, sessionToken.email], (err) => {
    if (err) return res.status(500).send("Failed to update password.");
    delete req.session.resetToken;
    res.send("Password updated successfully. You can now log in.");
  });
});



//cancel appointments
// app.post('/cancel', async (req, res) => {
//   const { AppointmentID } = req.body;
//    console.log(`trying to delete appointment: ${AppointmentID}`);
//   if (!AppointmentID) return res.status(400).send('Missing appointment ID');
  
//   try {
//     await db2.run(
//       'UPDATE appointment SET AppointmentStatus = ? WHERE AppointmentID = ?',
//       ['Cancelled', AppointmentID]
//     );
//     res.redirect('/myappointments');
//   } catch (err) {
//     console.error('Error cancelling appointment:', err);
//     res.status(500).send('Internal server error');
//   }
// });

// Cancel appointment route
app.post('/cancel',requireAuth, requireRole('SUPERVISOR', "ADMIN"), async (req, res) => {
  const { AppointmentID } = req.body;
  const mechanicId = req.session.user.id;

  
  console.log(`Trying to cancel appointment: ${AppointmentID}`);

  if (!AppointmentID) res.redirect(`/myappointments?error=Failture To Cancel Appointment.`);;

  try {
    // Step 1: Get the appointment and customer info, ensure it is SCHEDULED
    db2.get(
      `SELECT a.AppointmentID, a.AppointmentDate, a.TimeSlot, a.AppointmentStatus, 
              u.EmailAddress, u.FirstName
       FROM appointment a
       JOIN user u ON a.UserID = u.UserID
       WHERE a.AppointmentID = ?`,
      [AppointmentID],
      async (err, row) => {
        if (err) {
          console.error('Database error:', err);
          return res.redirect(`/myappointments?error=Database Error`);;
        }

        if (!row) {
          return res.redirect(`/myappointments?error=Appointment Not Found`);;
        }

        // Step 2: Check appointment status
        if (row.AppointmentStatus !== 'SCHEDULED') {
          return res.redirect(`/myappointments?error=Cannot Cancel Appointment. Appointment Is Already In-Progress`);;
        }

        // Step 3: Update the status to "Cancelled"
        db2.run(
          'UPDATE appointment SET AppointmentStatus = ? WHERE AppointmentID = ?',
          ['Cancelled', AppointmentID],
          async (err) => {
            if (err) {
              console.error('Error cancelling appointment:', err);
              return res.redirect(`/myappointments?error=Failed To Cancel Appointment`);;
            }

            // Step 4: Send the cancellation email
            const mailOptions = {
              from: process.env.EMAIL_USER,
              to: row.EmailAddress,
              subject: 'Your AMW Appointment Has Been Cancelled',
              text: `Hi ${row.FirstName},\n\nYour appointment on ${row.AppointmentDate} at ${row.TimeSlot} has been cancelled.\n\nIf this was a mistake, please contact us or rebook.\n\nRegards,\nAMW Team`
            };

            try {
              await transporter.sendMail(mailOptions);
              console.log('Cancellation email sent to', row.EmailAddress);
            } catch (emailErr) {
              console.error('Failed to send cancellation email:', emailErr);
            }

            res.redirect('/myappointments');
          }
        );
      }
    );
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).send('Internal server error');
  }
});

// //Role Checker for implementing access control
// function requireRole(role) {
//   return function (req, res, next) {
//     if (!req.session.user || req.session.user.role !== role) {
//       return res.status(403).send('Access denied.');
//     }
//     next();
//   };
// }

//assigning mechanic
// app.post('/assign/:appointmentId', requireAuth, requireRole('ADMIN'), (req, res) => {
//   const { appointmentId } = req.params;
//   const { MechanicAssigned } = req.body;

//   const query = `UPDATE appointment SET MechanicAssigned = ? WHERE AppointmentID = ?`;
//   db2.run(query, [MechanicAssigned, appointmentId], function (err) {
//     if (err) {
//       console.error(err);
//       return res.status(500).send('Failed to update mechanic.');
//     }
//     res.redirect('/myappointments');
//   });
// });

// Assign mechanic to appointment
app.post('/assign/:appointmentId', requireAuth, requireRole('SUPERVISOR'), (req, res) => {
  const { appointmentId } = req.params;
  const { MechanicAssigned } = req.body;

  // Step 1: Check if the assigned mechanic is actually a mechanic
  const checkMechanicQuery = `SELECT * FROM user WHERE UserID = ? AND UserType = 'MECHANIC'`;
  db2.get(checkMechanicQuery, [MechanicAssigned], (err, userRow) => {
    if (err) {
      console.error(err);
      return res.redirect(`/myappointments?error=DataBase Error While Checking Mechanic`);;
    }

    if (!userRow) {
      return res.redirect(`/myappointments?error=Invalid Mechanic User ID.`);
    }


    // Step 2: Update the appointment with the mechanic ID
    const updateQuery = `UPDATE appointment SET MechanicAssigned = ? WHERE AppointmentID = ?`;
    db2.run(updateQuery, [MechanicAssigned, appointmentId], function (err) {
      if (err) {
        console.error(err);
        return res.redirect(`/myappointments?error=Failed To Update Mechanic.`);;
      }
      res.redirect('/myappointments');
    });
  });
});

//Change appointment status
app.post('/update-status/:AppointmentId', requireAuth, requireRole('MECHANIC'), async (req, res) => {
  const { AppointmentId } = req.params;
  const { AppointmentStatus } = req.body;
  const mechanicId = req.session.user.id;

  // Step 1: Check if the appointment is assigned to this mechanic
  db2.get(`
    SELECT a.AppointmentID, a.AppointmentDate, a.TimeSlot, u.EmailAddress, u.FirstName
    FROM appointment a
    JOIN user u ON a.UserID = u.UserID
    WHERE a.AppointmentID = ? AND a.MechanicAssigned = ?
  `, [AppointmentId, mechanicId], async (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.redirect(`/myappointments?error=Databse Error.`);;
    }

    if (!row) {
      return res.redirect(`/myappointments?error=You Are Not Assigned To This Appointment.`);;
    }

    // Step 2: Update appointment status
    db2.run(`
      UPDATE appointment
      SET AppointmentStatus = ?
      WHERE AppointmentID = ?
    `, [AppointmentStatus, AppointmentId], async (err) => {
      if (err) {
        console.error('Error updating appointment status:', err);
        return res.redirect(`/myappointments?error=Failed To Upload Appointment Status.`);;
      }

      // Step 3: Send email notification to customer
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: row.EmailAddress,
        subject: `Update on Your AMW Appointment (Appointment ID: ${row.AppointmentID})`,
        text: `Hi ${row.FirstName},\n\nYour appointment on ${row.AppointmentDate} at ${row.TimeSlot} has been updated to status: ${AppointmentStatus}.\n\nThank you for choosing AMW.\n\nRegards,\nAMW Team`
      };

      try {
        await transporter.sendMail(mailOptions);
        console.log('Status update email sent to', row.EmailAddress);
      } catch (emailErr) {
        console.error('Failed to send status update email:', emailErr);
      }

      res.redirect('/myappointments');
    });
  });
});

// Error handling middleware
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
