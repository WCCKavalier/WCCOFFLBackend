const cron =require('cron');
const https =require('https');

const backendUrl = 'https://wccbackendoffl.onrender.com/api/teams';
const job = new cron.CronJob('*/14 * * * *', function(){
    const currentHour = new Date().getHours();
    const currentDay = new Date().getDay();
    if (currentDay === 6 && currentHour >= 1 && currentHour < 5) {
        console.log('Cron job skipped: Scheduled maintenance window (1 AM - 5 AM)');
        return;}
    if ((currentDay === 2 || currentDay === 3 || currentDay === 4) && (currentHour >= 11 && currentHour < 14)) {
        console.log('Cron job skipped: Scheduled downtime on Tue-Thu (11 AM - 2 PM)');
        return;
    }
    console.log('Restarting server');
    https.get(backendUrl,(res)=>{
        if(res.statusCode == 200){
            console.log('Server Running');
        }
        else{
            console.error(`Failed to restart :${res.statusCode}`);
        }
    })
    .on('error',(err)=>{
        console.error('Error during restart', err.message);
   });
});


module.exports = job;