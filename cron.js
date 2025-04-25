const cron = require('cron');
const axios = require('axios');
const Activity = require('./models/Activity');
const { sendPingFailureAlert } = require('./utils/mailer');

const UPTIME_ROBOT_API_KEY = process.env.UPTIME_ROBOT_API_KEY; // Make sure this is set in your .env
const MONITOR_ID = process.env.MONITOR_ID; // Also from .env
const UPTIME_ROBOT_API_URL = 'https://api.uptimerobot.com/v2/getMonitors';

const job = new cron.CronJob('*/14 * * * *', async function () {
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay();

  // Maintenance: Saturday 1 AM - 5 AM
  const inMaintenanceWindow = currentDay === 6 && currentHour >= 1 && currentHour < 5;

  // Scheduled downtime: Tue–Thu 11 AM - 2 PM
  const inScheduledDowntime = (currentDay >= 2 && currentDay <= 4) && currentHour >= 11 && currentHour < 14;

  if (inMaintenanceWindow || inScheduledDowntime) {
    console.log('⏱ Cron skipped: Within defined maintenance/downtime window.');
    return;
  }

  // Check recent user activity
  try {
    const activity = await Activity.findOne({ name: 'activityStatus' });
    if (activity && activity.lastActive) {
      const minutesSinceLastActive = (now - new Date(activity.lastActive)) / (1000 * 60);
      if (minutesSinceLastActive < 10) {
        console.log('🟢 Cron skipped: Recent user activity within 10 mins.');
        return;
      }
    }
  } catch (err) {
    console.error('❌ Activity check failed:', err.message);
  }

  // Ping UptimeRobot to check server status
  console.log('🚀 Checking server status with UptimeRobot API...');

  try {
    const response = await axios.post(
      UPTIME_ROBOT_API_URL,
      {
        api_key: UPTIME_ROBOT_API_KEY,
        monitors: MONITOR_ID, // IMPORTANT: This must be a string, not an array
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    const monitors = response.data?.monitors;
    if (monitors && monitors.length > 0) {
      const monitorStatus = monitors[0].status;

      if (monitorStatus === 2) {
        console.log('✅ Server is UP and responding.');
      } else {
        console.error(`❌ Server is DOWN! Monitor status: ${monitorStatus}`);
        sendPingFailureAlert(
          'WCC Server Ping Failed',
          `Server is down. UptimeRobot monitor status: ${monitorStatus}`
        );
      }
    } else {
      console.error('❌ No monitors found in response:', response.data);
      sendPingFailureAlert(
        'WCC Server Ping Error',
        'No monitors returned by UptimeRobot API.'
      );
    }
  } catch (err) {
    console.error('❌ UptimeRobot API request failed:', err.message);
    sendPingFailureAlert(
      'WCC Server Ping Error',
      `UptimeRobot API request failed: ${err.message}`
    );
  }
});

module.exports = job;
