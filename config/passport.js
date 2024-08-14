var passport = require('passport');
var LocalStrategy = require('passport-local');
var crypto = require('crypto');
var db = require('./db');

const users = require("../models/user.models");


passport.use(new LocalStrategy(async function verify(username, password, cb) {
  try {
    const usersCollection = db.db('htbackend').collection('users');

    const user = await usersCollection.findOne({ username: username });

    if (!user) {
      return cb(null, false, { message: 'Incorrect username or password.' });
    }

    // Verify the password
    crypto.pbkdf2(password, user.salt, 310000, 32, 'sha256', function(err, hashedPassword) {
      if (err) { return cb(err); }
      if (!crypto.timingSafeEqual(user.hashed_password, hashedPassword)) {
        return cb(null, false, { message: 'Incorrect username or password.' });
      }
      return cb(null, user);
    });
  } catch (err) {
    return cb(err);
  }
}));