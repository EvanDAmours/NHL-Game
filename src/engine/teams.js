// The 32 NHL clubs for 2026-27 with conference/division alignment and colors.

export const TEAMS = [
  // Eastern Conference — Atlantic
  { abbr: "BOS", city: "Boston", name: "Bruins", conf: "East", div: "Atlantic", colors: ["#FFB81C", "#111111"] },
  { abbr: "BUF", city: "Buffalo", name: "Sabres", conf: "East", div: "Atlantic", colors: ["#003087", "#FFB81C"] },
  { abbr: "DET", city: "Detroit", name: "Red Wings", conf: "East", div: "Atlantic", colors: ["#CE1126", "#FFFFFF"] },
  { abbr: "FLA", city: "Florida", name: "Panthers", conf: "East", div: "Atlantic", colors: ["#C8102E", "#041E42"] },
  { abbr: "MTL", city: "Montréal", name: "Canadiens", conf: "East", div: "Atlantic", colors: ["#AF1E2D", "#192168"] },
  { abbr: "OTT", city: "Ottawa", name: "Senators", conf: "East", div: "Atlantic", colors: ["#C52032", "#C2912C"] },
  { abbr: "TBL", city: "Tampa Bay", name: "Lightning", conf: "East", div: "Atlantic", colors: ["#002868", "#FFFFFF"] },
  { abbr: "TOR", city: "Toronto", name: "Maple Leafs", conf: "East", div: "Atlantic", colors: ["#00205B", "#FFFFFF"] },
  // Eastern Conference — Metropolitan
  { abbr: "CAR", city: "Carolina", name: "Hurricanes", conf: "East", div: "Metropolitan", colors: ["#CE1126", "#111111"] },
  { abbr: "CBJ", city: "Columbus", name: "Blue Jackets", conf: "East", div: "Metropolitan", colors: ["#002654", "#CE1126"] },
  { abbr: "NJD", city: "New Jersey", name: "Devils", conf: "East", div: "Metropolitan", colors: ["#CE1126", "#111111"] },
  { abbr: "NYI", city: "New York", name: "Islanders", conf: "East", div: "Metropolitan", colors: ["#00539B", "#F47D30"] },
  { abbr: "NYR", city: "New York", name: "Rangers", conf: "East", div: "Metropolitan", colors: ["#0038A8", "#CE1126"] },
  { abbr: "PHI", city: "Philadelphia", name: "Flyers", conf: "East", div: "Metropolitan", colors: ["#F74902", "#111111"] },
  { abbr: "PIT", city: "Pittsburgh", name: "Penguins", conf: "East", div: "Metropolitan", colors: ["#FCB514", "#111111"] },
  { abbr: "WSH", city: "Washington", name: "Capitals", conf: "East", div: "Metropolitan", colors: ["#C8102E", "#041E42"] },
  // Western Conference — Central
  { abbr: "CHI", city: "Chicago", name: "Blackhawks", conf: "West", div: "Central", colors: ["#CF0A2C", "#111111"] },
  { abbr: "COL", city: "Colorado", name: "Avalanche", conf: "West", div: "Central", colors: ["#6F263D", "#236192"] },
  { abbr: "DAL", city: "Dallas", name: "Stars", conf: "West", div: "Central", colors: ["#006847", "#8F8F8C"] },
  { abbr: "MIN", city: "Minnesota", name: "Wild", conf: "West", div: "Central", colors: ["#154734", "#A6192E"] },
  { abbr: "NSH", city: "Nashville", name: "Predators", conf: "West", div: "Central", colors: ["#FFB81C", "#041E42"] },
  { abbr: "STL", city: "St. Louis", name: "Blues", conf: "West", div: "Central", colors: ["#002F87", "#FCB514"] },
  { abbr: "UTA", city: "Utah", name: "Mammoth", conf: "West", div: "Central", colors: ["#6CACE4", "#111111"] },
  { abbr: "WPG", city: "Winnipeg", name: "Jets", conf: "West", div: "Central", colors: ["#041E42", "#7B9EC4"] },
  // Western Conference — Pacific
  { abbr: "ANA", city: "Anaheim", name: "Ducks", conf: "West", div: "Pacific", colors: ["#F47A38", "#B9975B"] },
  { abbr: "CGY", city: "Calgary", name: "Flames", conf: "West", div: "Pacific", colors: ["#C8102E", "#F1BE48"] },
  { abbr: "EDM", city: "Edmonton", name: "Oilers", conf: "West", div: "Pacific", colors: ["#FF4C00", "#041E42"] },
  { abbr: "LAK", city: "Los Angeles", name: "Kings", conf: "West", div: "Pacific", colors: ["#A2AAAD", "#111111"] },
  { abbr: "SJS", city: "San Jose", name: "Sharks", conf: "West", div: "Pacific", colors: ["#006D75", "#EA7200"] },
  { abbr: "SEA", city: "Seattle", name: "Kraken", conf: "West", div: "Pacific", colors: ["#99D9D9", "#001628"] },
  { abbr: "VAN", city: "Vancouver", name: "Canucks", conf: "West", div: "Pacific", colors: ["#00843D", "#00205B"] },
  { abbr: "VGK", city: "Vegas", name: "Golden Knights", conf: "West", div: "Pacific", colors: ["#B4975A", "#333F42"] },
];

export const CONFERENCES = ["East", "West"];
export const DIVISIONS = { East: ["Atlantic", "Metropolitan"], West: ["Central", "Pacific"] };
