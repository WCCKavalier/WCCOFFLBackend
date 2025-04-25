const axios = require('axios');
const Activity = require('../models/Activity');
const { sendPingFailureAlert } = require('../utils/mailer');

// Get the API key and monitor ID from environment variables (GitHub Secrets)
const UPTIME_ROBOT_API_KEY = process.env.UPTIME_ROBOT_API_KEY;
const MONITOR_ID = process.env.MONITOR_ID;
const GET_MONITOR_URL = 'https://api.uptimerobot.com/v2/getMonitors';
const EDIT_MONITOR_URL = 'https://api.uptimerobot.com/v2/editMonitor';

async function checkUptime() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay();

  // Maintenance: Saturday 1 AM - 5 AM
  const inMaintenanceWindow = currentDay === 6 && currentHour >= 1 && currentHour < 5;

  // Scheduled downtime: Tue–Thu 11 AM - 2 PM
  const inScheduledDowntime = (currentDay >= 2 && currentDay <= 4) && currentHour >= 11 && currentHour < 14;

  const shouldPause = inMaintenanceWindow || inScheduledDowntime;

  // Get current monitor status
  let monitorStatus = null;
  try {
    const monitorResponse = await axios.post(
      GET_MONITOR_URL,
      {
        api_key: UPTIME_ROBOT_API_KEY,
        monitors: MONITOR_ID,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    const monitors = monitorResponse.data?.monitors;
    if (monitors && monitors.length > 0) {
      monitorStatus = monitors[0].status; // 2 = up, 9 = paused
    } else {
      console.error('❌ No monitors found in response');
    }
  } catch (err) {
    console.error('❌ Failed to fetch monitor status:', err.message);
    return;
  }

  // Pause or Resume Monitor
  try {
    if (shouldPause && monitorStatus !== 9) {
      await axios.post(
        EDIT_MONITOR_URL,
        {
          api_key: UPTIME_ROBOT_API_KEY,
          monitor_id: MONITOR_ID,
          status: 0, // 0 = pause
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      console.log('⏸ Monitor paused due to maintenance/downtime window.');
      return;
    } else if (!shouldPause && monitorStatus === 9) {
      await axios.post(
        EDIT_MONITOR_URL,
        {
          api_key: UPTIME_ROBOT_API_KEY,
          monitor_id: MONITOR_ID,
          status: 1, // 1 = resume
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      console.log('▶️ Monitor resumed after maintenance/downtime.');
    }
  } catch (err) {
    console.error('❌ Failed to change monitor status:', err.message);
    return;
  }

  // Check recent user activity
  try {
    const activity = await Activity.findOne({ name: 'activityStatus' });
    if (activity && activity.lastActive) {
      const minutesSinceLastActive = (now - new Date(activity.lastActive)) / (1000 * 60);
      if (minutesSinceLastActive < 10) {
        console.log('🟢 Skipping check due to recent user activity.');
        return;
      }
    }
  } catch (err) {
    console.error('❌ Activity check failed:', err.message);
  }

  // Final uptime check if not in paused window
  try {
    const response = await axios.post(
      GET_MONITOR_URL,
      {
        api_key: UPTIME_ROBOT_API_KEY,
        monitors: MONITOR_ID,
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
}

// Run the uptime check
checkUptime();
