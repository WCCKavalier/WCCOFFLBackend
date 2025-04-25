const axios = require('axios');
const dotenv = require("dotenv");
const mongoose = require('mongoose');
dotenv.config();
const Activity = require('../models/Activity');
const { sendPingFailureAlert } = require('../utils/mailer');
const connectDB = require("../config/db");

connectDB();

const UPTIME_ROBOT_API_KEY = process.env.UPTIME_ROBOT_API_KEY;
const MONITOR_ID = process.env.MONITOR_ID;
const GET_MONITOR_URL = 'https://api.uptimerobot.com/v2/getMonitors';
const EDIT_MONITOR_URL = 'https://api.uptimerobot.com/v2/editMonitor';

const SERVER_PING_URL = 'https://wccbackendoffl.onrender.com/ping';

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
        headers: { 'Content-Type': 'application/json' },
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
    return cleanExit(1);
  }

  // Pause or Resume Monitor
  try {
    if (shouldPause && monitorStatus !== 9) {
      await axios.post(
        EDIT_MONITOR_URL,
        {
          api_key: UPTIME_ROBOT_API_KEY,
          monitor_id: MONITOR_ID,
          status: 0, // pause
        },
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
      console.log('⏸ Monitor paused due to maintenance/downtime window.');
      return cleanExit(0);
    } else if (!shouldPause && monitorStatus === 9) {
      await axios.post(
        EDIT_MONITOR_URL,
        {
          api_key: UPTIME_ROBOT_API_KEY,
          monitor_id: MONITOR_ID,
          status: 1, // resume
        },
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
      console.log('▶️ Monitor resumed after maintenance/downtime.');
    }
  } catch (err) {
    console.error('❌ Failed to change monitor status:', err.message);
    return cleanExit(1);
  }

  // Check recent user activity
  try {
    const activity = await Activity.findOne({ name: 'activityStatus' });

    if (activity && activity.lastActive) {
      const minutesSinceLastActive = (now - new Date(activity.lastActive)) / (1000 * 60);
      console.log(`Minutes since last activity: ${minutesSinceLastActive}`);

      if (minutesSinceLastActive > 14) {
        console.log('❌ No user activity detected for 14+ minutes. Initiating ping check...');
        await sendPingFailureAlert(
          'WCC Server Inactivity',
          'No user activity detected. Server is being pinged.'
        );

        try {
          const pingResponse = await axios.get(SERVER_PING_URL);
          if (pingResponse.status === 200 && pingResponse.data === 'pong') {
            console.log('✅ Server is responding to ping!');
          } else {
            console.error('❌ Unexpected ping response:', pingResponse.data);
            await sendPingFailureAlert(
              'WCC Server Ping Error',
              `Unexpected response from ping endpoint: ${pingResponse.data}`
            );
          }
        } catch (pingError) {
          console.error('❌ Failed to ping server:', pingError.message);
          await sendPingFailureAlert(
            'WCC Server Ping Error',
            `Failed to ping the server: ${pingError.message}`
          );
        }
      } else {
        console.log('🟢 User activity detected recently, skipping ping.');
      }
    } else {
      console.log('❌ No activity record found. Initiating ping check...');
      // await sendPingFailureAlert(
      //   'WCC Server Inactivity',
      //   'No activity record found. Server is being pinged.'
      // );

      try {
        const pingResponse = await axios.get(SERVER_PING_URL);
        if (pingResponse.status === 200 && pingResponse.data === 'pong') {
          console.log('✅ Server is responding to ping!');
        } else {
          console.error('❌ Unexpected ping response:', pingResponse.data);
          await sendPingFailureAlert(
            'WCC Server Ping Error',
            `Unexpected response from ping endpoint: ${pingResponse.data}`
          );
        }
      } catch (pingError) {
        console.error('❌ Failed to ping server:', pingError.message);
        await sendPingFailureAlert(
          'WCC Server Ping Error',
          `Failed to ping the server: ${pingError.message}`
        );
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
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const monitors = response.data?.monitors;
    if (monitors && monitors.length > 0) {
      const monitorStatus = monitors[0].status;
      if (monitorStatus === 2) {
        console.log('✅ Server is UP and responding.');
      } else {
        console.error(`❌ Server is DOWN! Monitor status: ${monitorStatus}`);
        try {
          await axios.get(SERVER_PING_URL);
          console.log('Server pinged successfully (async call).');
        } catch (pingError) {
          console.error('❌ Failed to ping server:', pingError.message);
        }
        await sendPingFailureAlert(
          'WCC Server Ping Failed',
          `Server is down. UptimeRobot monitor status: ${monitorStatus}`
        );
      }
    } else {
      console.error('❌ No monitors found in response:', response.data);
      await sendPingFailureAlert(
        'WCC Server Ping Error',
        'No monitors returned by UptimeRobot API.'
      );
    }
  } catch (err) {
    console.error('❌ UptimeRobot API request failed:', err.message);
    await sendPingFailureAlert(
      'WCC Server Ping Error',
      `UptimeRobot API request failed: ${err.message}`
    );
  }

  // Clean exit
  cleanExit(0);
}

async function cleanExit(code) {
  try {
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed.');
  } catch (err) {
    console.error('❌ Error closing MongoDB connection:', err.message);
  }
  process.exit(code);
}

// Run the uptime check
(async () => {
  await checkUptime();
})();
