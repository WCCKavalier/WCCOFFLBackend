const cron =require('cron');
const https =require('https');

const backendUrl = 'https://wccbackend.onrender.com/api/teams';
const job = new cron.CronJob('*/14 * * * *', function(){
    const currentHour = new Date().getHours();
    const currentDay = new Date().getDay();
    if (currentDay === 5 && currentHour >= 1 && currentHour < 4) {
        console.log('Cron job skipped: Scheduled maintenance window (1 AM - 4 AM)');
        return;}
    if ((currentDay === 2 || currentDay === 3 || currentDay === 4) && (currentHour >= 11 && currentHour < 13)) {
        console.log('Cron job skipped: Scheduled downtime on Tue-Thu (11 AM - 1 PM)');
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