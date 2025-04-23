// cron.js
const cron = require('cron');
const https = require('https');
const Activity = require('./models/Activity');

const backendUrl = 'https://wccbackendoffl.onrender.com/api/teams';

const job = new cron.CronJob('*/14 * * * *', async function () {
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay();

  // 🛠 Scheduled maintenance window
  if (currentDay === 6 && currentHour >= 1 && currentHour < 5) {
    console.log('⏱ Cron skipped: Saturday 1 AM - 5 AM maintenance window.');
    return;
  }

  // ⏸ Scheduled downtime Tue-Thu 11 AM - 2 PM
  if ((currentDay === 2 || currentDay === 3 || currentDay === 4) && (currentHour >= 11 && currentHour < 14)) {
    console.log('⏸ Cron skipped: Tue-Thu 11 AM - 2 PM downtime.');
    return;
  }

  try {
    const isActive = await Activity.exists({ name: 'activityStatus' });

    if (isActive) {
      console.log('🟢 Cron skipped: Recent user activity detected.');
      return;
    }
  } catch (err) {
    console.error('❌ Error checking activity:', err.message);
  }

  // 🚀 Ping server to keep it warm
  console.log('🌐 No recent user activity. Pinging server...');

  https.get(backendUrl, (res) => {
    if (res.statusCode === 200) {
      console.log('✅ Server pinged successfully.');
    } else {
      console.error(`❌ Ping failed with status code: ${res.statusCode}`);
    }
  }).on('error', (err) => {
    console.error('❌ Ping error:', err.message);
  });
});

module.exports = job;
