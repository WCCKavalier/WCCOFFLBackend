const axios = require('axios');
const dotenv = require("dotenv");
const mongoose = require('mongoose');
dotenv.config();
const Activity = require('../models/Activity');
const JobLog = require('../models/JobLog');
const { sendPingFailureAlert } = require('../utils/mailer');
const connectDB = require("../config/db");

connectDB();

const BETTERSTACK_API_KEY = process.env.BETTERSTACK_API_KEY;
const MONITOR_ID = process.env.MONITOR_ID;
const SERVER_PING_URL = 'https://wccbackendoffl.onrender.com/ping';
const BETTERSTACK_BASE_URL = 'https://betteruptime.com/api/v2';

async function logJobRun(status, message = '') {
  try {
    await JobLog.create({ status, message });
    console.log(`📝 Logged job run: ${status}`);
  } catch (err) {
    console.error('❌ Failed to log job run:', err.message);
  }
}

async function checkUptime() {
  const now = new Date();
  const options = { timeZone: 'Asia/Kolkata', hour: 'numeric', weekday: 'short', hour12: false };
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(now);

  let currentHour = null;
  let currentDay = null;

  parts.forEach(({ type, value }) => {
    if (type === 'hour') currentHour = parseInt(value, 10);
    if (type === 'weekday') {
      currentDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(value);
    }
  });

  console.log(`Current Time (IST): Hour=${currentHour}, Day=${currentDay}`);

  const inMaintenanceWindow = (currentDay >= 0 && currentDay <= 5) && (currentHour >= 1 && currentHour < 5);
  const inScheduledDowntime = (currentDay >= 2 && currentDay <= 4) && (currentHour >= 11 && currentHour < 14);

  let shouldPause = inMaintenanceWindow || inScheduledDowntime;

  // const nowMinutes = new Date().getMinutes();
  // const istOptions = { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: 'numeric', hour12: false };
  // const istTime = new Intl.DateTimeFormat('en-US', istOptions).formatToParts(new Date());

  // let istHour = null;
  // let istMinute = null;
  // istTime.forEach(({ type, value }) => {
  //   if (type === 'hour') istHour = parseInt(value, 10);
  //   if (type === 'minute') istMinute = parseInt(value, 10);
  // });

  // if (istHour === 10 && istMinute === 8) {
  //   console.log('🧪 [TEST MODE] Forcing shouldPause = true at 8:09 AM IST');
  //   shouldPause = true;
  // }

  console.log(`Should pause monitor: ${shouldPause}`);

  // Get current monitor status
  let isPaused = null;
  try {
    const monitorResponse = await axios.get(
      `${BETTERSTACK_BASE_URL}/monitors/${MONITOR_ID}`,
      {
        headers: {
          Authorization: `Bearer ${BETTERSTACK_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    isPaused = monitorResponse.data?.data?.attributes?.paused;
    console.log(`Current Monitor Status: ${isPaused ? 'Paused' : 'Running'}`);
  } catch (err) {
    console.error('❌ Failed to fetch monitor status:', err.message);
    await logJobRun('failure', 'Better Stack monitor fetch failed.');
    return cleanExit(1);
  }

  // Pause or Resume Monitor
  let monitorPaused = false;  // Flag to track monitor pause status
  try {
    if (shouldPause && !isPaused) {
      const response = await axios.patch(
        `${BETTERSTACK_BASE_URL}/monitors/${MONITOR_ID}`,
        { paused: true },
        {
          headers: {
            Authorization: `Bearer ${BETTERSTACK_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );
      console.log('⏸ Monitor paused for maintenance/downtime window.');
      await logJobRun('success', '⏸ Monitor paused due to maintenance/downtime window');
      monitorPaused = true;  // Set the flag when monitor is paused
    } else if (!shouldPause && isPaused) {
      const response = await axios.patch(
        `${BETTERSTACK_BASE_URL}/monitors/${MONITOR_ID}`,
        { paused: false },
        {
          headers: {
            Authorization: `Bearer ${BETTERSTACK_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );
      console.log('▶️ Monitor resumed after maintenance/downtime.');
    }
  } catch (err) {
    console.error('❌ Failed to change monitor status:', err.message);
    await logJobRun('failure', 'Better Stack monitor status change failed.');
    return cleanExit(1);
  }

  // Skip the final log if the monitor is paused
  if (monitorPaused) {
    console.log('⏸ Monitor pause already logged, skipping final check.');
  } else {
    // Check recent user activity
    try {
      const activity = await Activity.findOne({ name: 'activityStatus' });

      if (activity && activity.lastActive) {
        const minutesSinceLastActive = (now - new Date(activity.lastActive)) / (1000 * 60);
        console.log(`Minutes since last activity: ${minutesSinceLastActive}`);

        if (minutesSinceLastActive > 14) {
          console.log('❌ No user activity detected for 14+ minutes. Initiating ping check...');
          await sendPingFailureAlert('WCC Server Inactivity', 'No user activity detected. Server is being pinged.');
          try {
            const pingResponse = await axios.get(SERVER_PING_URL);
            if (pingResponse.status === 200 && pingResponse.data === 'pong') {
              console.log('✅ Server is responding to ping!');
            } else {
              console.error('❌ Unexpected ping response:', pingResponse.data);
              await sendPingFailureAlert('WCC Server Ping Error', `Unexpected response from ping endpoint: ${pingResponse.data}`);
            }
          } catch (pingError) {
            console.error('❌ Failed to ping server:', pingError.message);
            await sendPingFailureAlert('WCC Server Ping Error', `Failed to ping the server: ${pingError.message}`);
          }
        } else {
          console.log('🟢 User activity detected recently, skipping ping.');
        }
      } else {
        console.log('❌ No activity record found. Initiating ping check...');
        try {
          const pingResponse = await axios.get(SERVER_PING_URL);
          if (pingResponse.status === 200 && pingResponse.data === 'pong') {
            console.log('✅ Server is responding to ping!');
          } else {
            console.error('❌ Unexpected ping response:', pingResponse.data);
            await sendPingFailureAlert('WCC Server Ping Error', `Unexpected response from ping endpoint: ${pingResponse.data}`);
          }
        } catch (pingError) {
          console.error('❌ Failed to ping server:', pingError.message);
          await sendPingFailureAlert('WCC Server Ping Error', `Failed to ping the server: ${pingError.message}`);
        }
      }
    } catch (err) {
      console.error('❌ Activity check failed:', err.message);
    }

    // Final uptime confirmation - Skip if monitor is already paused
    try {
      const finalMonitorResponse = await axios.get(
        `${BETTERSTACK_BASE_URL}/monitors/${MONITOR_ID}`,
        {
          headers: {
            Authorization: `Bearer ${BETTERSTACK_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );
    
      const monitor = finalMonitorResponse.data?.data;
      if (monitor && !monitor.attributes.paused) {
        console.log('✅ Server monitor is running.');
      } else {
        if (!shouldPause) {
          console.error('❌ Monitor is paused unexpectedly.');
          await sendPingFailureAlert('WCC Server Ping Failed', 'Server monitor is paused unexpectedly.');
        } else {
          console.log('⏸ Monitor is intentionally paused for maintenance or downtime.');
        }
      }
    } catch (err) {
      console.error('❌ Better Stack API request failed:', err.message);
      await sendPingFailureAlert('WCC Server Ping Error', `Better Stack API request failed: ${err.message}`);
    }

    // **Only log "Server check completed successfully" if the monitor was not paused.**
    if (!monitorPaused) {
      await logJobRun('success', 'Server is Running.');
    }
  }

  return cleanExit(0);
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