const cron = require('cron');
const https = require('https');
const Activity = require('./models/Activity');
const { sendPingFailureAlert } = require('./utils/mailer');

const backendUrl = 'https://wccbackendoffl.onrender.com/ping';

const job = new cron.CronJob('*/14 * * * *', async function () {
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay();

  // 🛠 Maintenance window: Saturday 1 AM - 5 AM
  const inMaintenanceWindow = currentDay === 6 && currentHour >= 1 && currentHour < 5;

  // ⏸ Scheduled downtime: Tue-Thu 11 AM - 2 PM
  const inScheduledDowntime = (currentDay >= 2 && currentDay <= 4) && currentHour >= 11 && currentHour < 14;

  if (inMaintenanceWindow || inScheduledDowntime) {
    console.log('⏱ Cron skipped: Within defined maintenance/downtime window.');
    return;
  }

  // ⏱ Only skip ping if recent user activity within last 10 mins
  try {
    const activity = await Activity.findOne({ name: 'activityStatus' });

    if (activity && activity.lastActive) {
      const lastActiveTime = new Date(activity.lastActive);
      const minutesSinceLastActive = (now - lastActiveTime) / (1000 * 60);

      if (minutesSinceLastActive < 10) {
        console.log('🟢 Cron skipped: Recent user activity within 10 mins.');
        return;
      }
    }
  } catch (err) {
    console.error('❌ Activity check failed:', err.message);
  }

  // 🌐 Pinging server
  console.log('🚀 Pinging server to wake it up...');

  https.get(backendUrl, (res) => {
    if (res.statusCode === 200) {
      console.log('✅ Server responded successfully.');
    } else {
      console.error(`❌ Ping failed with status code: ${res.statusCode}`);
      sendPingFailureAlert(
        'WCC Server Ping Failed',
        `Ping failed with status code: ${res.statusCode}`
      );
    }
  }).on('error', (err) => {
    console.error('❌ Ping error:', err.message);
    sendPingFailureAlert(
      'WCC Server Ping Error',
      `Ping error: ${err.message}`
    );
  });
});

module.exports = job;
