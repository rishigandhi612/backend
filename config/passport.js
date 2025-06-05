var passport = require('passport');
var LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs'); // For comparing hashed passwords
const User = require('../models/user.models'); // Import your User model

// Initialize Passport and session (assuming Express app is already defined as 'app')
app.use(passport.initialize());
app.use(passport.session());
// Configure Local Strategy
passport.use(new LocalStrategy(
 
  { usernameField: 'emailid' }, // Use 'emailid' instead of default 'username'
  function(emailid, password, done) {
    // console.log(emailid,password);
    // Find user in the database by email
    User.findOne({ emailid: emailid }, function (err, user) {
      if (err) { return done(err); }  // Handle error
      if (!user) { return done(null, false, { message: 'Incorrect email.' }); }  // No user found

      // Compare the provided password with the stored hash
      bcrypt.compare(password, user.password, function(err, isMatch) {
        if (err) return done(err);  // Handle error during comparison
        if (!isMatch) {
          return done(null, false, { message: 'Incorrect password.' });
        }
        return done(null, user);  // If password matches, return user
      });
    });
  }
));

// Serialize user for session
passport.serializeUser(function(user, done) {
  done(null, user.id);  // Serialize the user ID for session
});

// Deserialize user from session
passport.deserializeUser(function(id, done) {
  User.findById(id, function (err, user) {
    done(err, user);  // Deserialize the user based on the ID stored in session
  });
});
