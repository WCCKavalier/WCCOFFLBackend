const fs = require('fs');
const pdf = require('pdf-parse');

const parseMatchReport = async (pdfPath) => {
  const dataBuffer = fs.readFileSync(pdfPath);
  const data = await pdf(dataBuffer);
  const text = data.text;

  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length);

  // Match Info
  const matchTitle = extractLine(lines, 'Tournament');
  const venue = extractLine(lines, 'Venue');
  const date = extractLine(lines, 'Date & Time');
  const toss = extractLine(lines, 'Toss');
  const result = extractLine(lines, 'Result');
  const playerOfTheMatch = extractLine(lines, 'Player Of The Match') || '-';
  const matchId = extractLine(lines, 'Match ID');

  const innings = [];

  // Parse Innings
  const inningsIndexes = [];
  lines.forEach((line, idx) => {
    if (line.includes('1st Innings Scorecard') || line.includes('2nd Innings Scorecard')) {
      inningsIndexes.push(idx);
    }
  });

  for (let i = 0; i < inningsIndexes.length; i++) {
    const start = inningsIndexes[i];
    const end = inningsIndexes[i + 1] || lines.length;
    const inningsLines = lines.slice(start, end);

    const teamLine = inningsLines[1]; 
    const team = teamLine.split(' R')[0].trim();

    // Batting
    const players = [];
    for (let j = 2; j < inningsLines.length; j++) {
      const line = inningsLines[j];
      if (line.startsWith('Extras')) break;

      const parts = line.split(/\s+/);
      if (parts.length >= 6) {
        const name = parts[0];
        const howOut = line.includes('not out') ? 'not out' : line.includes('b ') ? 'b ' + line.split('b ')[1].split(' ')[0] : 'unknown';
        const stats = parts.slice(-5).map(Number); 

        players.push({
          name,
          runs: stats[0],
          balls: stats[1],
          fours: stats[2],
          sixes: stats[3],
          sr: stats[4],
          howOut
        });
      }
    }

    // Extras and Total
    const extrasLine = inningsLines.find(line => line.startsWith('Extras'));
    const totalLine = inningsLines.find(line => line.startsWith('Total'));

    const extras = extrasLine ? extrasLine.split('Extras')[1].trim() : '';
    const total = totalLine ? totalLine.split(' ')[1] : '';
    const overs = inningsLines.find(line => line.startsWith('Overs'))?.split(' ')[1] || '';
    const runRate = parseFloat(inningsLines.find(line => line.startsWith('Run Rate'))?.split(' ')[2]) || 0;

    // Fall of Wickets
    const fallOfWicketsLine = inningsLines.find(line => line.startsWith('Fall Of Wickets'));
    const fallOfWickets = fallOfWicketsLine ? fallOfWicketsLine.split('Fall Of Wickets')[1].trim() : '';

    // Bowling
    const bowlers = [];
    const bowlerStartIndex = inningsLines.findIndex(line => line.startsWith('Bowler')) + 1;
    for (let j = bowlerStartIndex; j < inningsLines.length; j++) {
      const line = inningsLines[j];
      if (!line || line.includes('https://')) break;

      const parts = line.split(/\s+/);
      if (parts.length >= 10) {
        bowlers.push({
          name: parts[0],
          overs: parts[1],
          runs: Number(parts[3]),
          wickets: Number(parts[4]),
          eco: Number(parts[5]),
          dots: Number(parts[6]),
          fours: Number(parts[7]),
          sixes: Number(parts[8]),
          wd: Number(parts[9]),
          nb: Number(parts[10] || 0),
        });
      }
    }

    innings.push({
      team,
      total,
      overs,
      runRate,
      players,
      extras,
      fallOfWickets,
      bowlers
    });
  }

  return {
    matchTitle,
    venue,
    date,
    toss,
    result,
    playerOfTheMatch,
    matchId,
    innings
  };
};

// Helper to extract a line's value by prefix
function extractLine(lines, key) {
  const line = lines.find(line => line.startsWith(key));
  return line ? line.replace(`${key}`, '').trim() : '';
}

module.exports = parseMatchReport;
