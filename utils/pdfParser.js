const fs = require('fs');
const pdf = require('pdf-parse');

const parseMatchReport = async (pdfPath) => {
  const dataBuffer = fs.readFileSync(pdfPath);
  const data = await pdf(dataBuffer);
  const text = data.text;

  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length);

  const extractLine = (key) => {
    const line = lines.find(line => line.toLowerCase().startsWith(key.toLowerCase()));
    return line ? line.replace(new RegExp(`${key}\\s*:?\\s*`, 'i'), '').trim() : '';
  };

  const matchTitle = extractLine('Tournament');
  const venue = extractLine('Venue');
  const date = extractLine('Date & Time');
  const toss = extractLine('Toss');
  const result = extractLine('Result');
  const playerOfTheMatch = extractLine('Player Of The Match') || '-';
  const matchId = extractLine('Match ID');

  const innings = [];

  const inningsIndexes = lines
    .map((line, index) => (/1st Innings Scorecard|2nd Innings Scorecard/i.test(line) ? index : -1))
    .filter(index => index !== -1);

  for (let i = 0; i < inningsIndexes.length; i++) {
    const start = inningsIndexes[i];
    const end = inningsIndexes[i + 1] || lines.length;
    const inningsLines = lines.slice(start, end);

    const teamLine = inningsLines[1] || '';
    const team = teamLine.split(' R')[0].trim();

    const players = [];
    for (let j = 2; j < inningsLines.length; j++) {
      const line = inningsLines[j];
      if (/^Extras/i.test(line)) break;

      const nextLine = inningsLines[j + 1] || '';
      const combined = `${line} ${nextLine}`.trim();

      const parts = combined.split(/\s+/);
      if (parts.length >= 6 && !/^Extras/i.test(parts[0])) {
        const stats = parts.slice(-5).map(Number);
        const name = parts.slice(0, parts.length - 5).join(' ');

        const howOut =
          /not out/i.test(combined) ? 'not out' :
          /b\s+/.test(combined) ? 'b ' + combined.split('b ')[1].split(' ')[0] :
          'unknown';

        players.push({
          name,
          runs: stats[0],
          balls: stats[1],
          fours: stats[2],
          sixes: stats[3],
          sr: stats[4],
          howOut
        });
        j++; // Skip next line
      }
    }

    const extrasLine = inningsLines.find(l => /^Extras/i.test(l));
    const extras = extrasLine ? extrasLine.replace(/^Extras\s*:?/i, '').trim() : '';

    const oversLine = inningsLines.find(l => /^Overs/i.test(l));
    const overs = oversLine ? oversLine.split(/\s+/)[1] : '';

    const totalLine = inningsLines.find(l => /^Total/i.test(l));
    const total = totalLine ? totalLine.split(/\s+/)[1] : '';

    const runRateLine = inningsLines.find(l => /^Run Rate/i.test(l));
    const runRate = runRateLine ? parseFloat(runRateLine.split(/\s+/).pop()) : 0;

    const fowLine = inningsLines.find(l => /Fall Of Wickets/i.test(l));
    const fallOfWickets = fowLine ? fowLine.replace(/Fall Of Wickets\s*:?/i, '').trim() : '';

    // Bowling
    const bowlers = [];
    const bowlerHeaderIdx = inningsLines.findIndex(l => /^Bowler/i.test(l));
    for (let j = bowlerHeaderIdx + 1; j < inningsLines.length; j++) {
      const line = inningsLines[j];
      if (!line || line.includes('https://')) break;

      const parts = line.split(/\s+/);
      if (parts.length >= 10) {
        const stats = parts.slice(-10);
        const name = parts.slice(0, parts.length - 10).join(' ');

        bowlers.push({
          name,
          overs: stats[0],
          runs: Number(stats[2]),
          wickets: Number(stats[3]),
          eco: Number(stats[4]),
          dots: Number(stats[5]),
          fours: Number(stats[6]),
          sixes: Number(stats[7]),
          wd: Number(stats[8]),
          nb: Number(stats[9])
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

module.exports = parseMatchReport;
