const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');

module.exports = {
  DATA_DIR,
  dbPath: path.join(DATA_DIR, 'poker.db'),
  avatarDir: path.join(DATA_DIR, 'avatars'),
  achievementDir: path.join(DATA_DIR, 'achievements'),
};
