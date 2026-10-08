// Name pools for generated (fictional) players: draft prospects, depth call-ups
// and random-league mode. Weighted roughly by where NHL players come from.
import { rand, pick } from "./rng.js";

const POOLS = {
  CAN: {
    w: 40,
    first: ["Liam", "Noah", "Logan", "Owen", "Carter", "Brayden", "Cole", "Ryan", "Tyler", "Dylan", "Evan", "Jordan", "Mason", "Nathan", "Connor", "Jake", "Luke", "Jack", "Brady", "Cameron", "Mathieu", "Alexis", "Samuel", "Gabriel", "Zach", "Austin", "Kyle", "Matthew", "Ethan", "Hunter", "Parker", "Riley", "Spencer", "Travis", "Wyatt", "Colby", "Brendan", "Jared", "Shane", "Mitchell", "Tanner", "Dawson", "Easton", "Landon", "Bennett", "Quinn", "Reid", "Jett", "Rowan", "Beckett"],
    last: ["MacDonald", "Campbell", "Tremblay", "Gagnon", "Roy", "Côté", "Bouchard", "Gauthier", "Morin", "Lavoie", "Fortin", "Gagné", "Ouellet", "Pelletier", "Bélanger", "Lévesque", "Bergeron", "Leblanc", "Paquette", "Girard", "Simard", "Boucher", "Caron", "Beaulieu", "Cloutier", "Dubé", "Poirier", "Fournier", "Lapointe", "Leclerc", "Lefebvre", "Mercier", "Thompson", "Stewart", "Robertson", "Murray", "Fraser", "Henderson", "McLeod", "Sinclair", "Ferguson", "Gallagher", "McKenzie", "Douglas", "Graham", "Ross", "Bennett", "Dawson", "Harper", "Kerr", "Lockhart", "Moffat", "Ritchie", "Sutherland", "Wallace", "Black", "Fleming", "Gillis", "MacLean", "Thibodeau"],
  },
  USA: {
    w: 25,
    first: ["Jack", "Cole", "Brock", "Charlie", "Matt", "Trevor", "Jake", "Joe", "Kyle", "Chris", "Nick", "Patrick", "Ryan", "Zach", "Brady", "Logan", "Mason", "Owen", "Will", "Sam", "Tommy", "Danny", "Mike", "Shane", "Cutter", "Gavin", "Hunter", "Ty", "Jimmy", "Bobby", "Drew", "Grant", "Colin", "Aidan", "Caden"],
    last: ["Miller", "Johnson", "Smith", "Anderson", "Murphy", "O'Brien", "Sullivan", "Kelly", "Ryan", "Walsh", "Hayes", "Doyle", "Brennan", "Gallagher", "Callahan", "Donovan", "Fitzgerald", "Shea", "Larson", "Peterson", "Olson", "Nelson", "Carlson", "Hanson", "Erickson", "Lindquist", "Gustafson", "Swanson", "Brooks", "Foster", "Carter", "Reed", "Price", "Hughes", "Parker", "Cooper", "Wagner", "Becker", "Schultz", "Keller"],
  },
  SWE: {
    w: 10,
    first: ["Elias", "Lucas", "Oskar", "William", "Isak", "Filip", "Viktor", "Anton", "Albin", "Emil", "Hampus", "Jesper", "Linus", "Rasmus", "Gustav", "Adam", "Axel", "Ludvig", "Melker", "Theo"],
    last: ["Andersson", "Johansson", "Karlsson", "Nilsson", "Eriksson", "Larsson", "Olsson", "Persson", "Svensson", "Gustafsson", "Pettersson", "Lindholm", "Lindström", "Sandström", "Bergström", "Lundqvist", "Forsberg", "Ekholm", "Wallin", "Holm", "Sundqvist", "Nyström", "Åberg", "Hedlund", "Lindgren"],
  },
  FIN: {
    w: 7,
    first: ["Aleksi", "Eetu", "Joni", "Kasperi", "Mikko", "Patrik", "Roope", "Sami", "Teuvo", "Ville", "Juuso", "Otto", "Aatu", "Konsta", "Kaapo", "Niko", "Eeli", "Leevi", "Topi", "Joel"],
    last: ["Virtanen", "Korhonen", "Mäkinen", "Nieminen", "Mäkelä", "Hämäläinen", "Laine", "Heikkinen", "Koskinen", "Järvinen", "Lehtonen", "Lehtinen", "Saarinen", "Salminen", "Heinonen", "Niemi", "Kinnunen", "Salonen", "Turunen", "Rantanen", "Lundell", "Kakko", "Räty", "Hirvonen"],
  },
  RUS: {
    w: 8,
    first: ["Alexander", "Dmitri", "Ivan", "Nikita", "Kirill", "Artem", "Pavel", "Yegor", "Danila", "Matvei", "Mikhail", "Sergei", "Andrei", "Vladislav", "Ilya", "Maxim", "Arseni", "Semyon", "Timur", "Fyodor"],
    last: ["Ivanov", "Smirnov", "Kuznetsov", "Popov", "Sokolov", "Lebedev", "Kozlov", "Novikov", "Morozov", "Petrov", "Volkov", "Solovyov", "Vasiliev", "Zaitsev", "Pavlov", "Semyonov", "Golubev", "Vinogradov", "Bogdanov", "Vorobyov", "Fedorov", "Mikhailov", "Belyaev", "Tarasov", "Orlov"],
  },
  CZE: {
    w: 5,
    first: ["Jakub", "Ondřej", "Tomáš", "David", "Martin", "Lukáš", "Filip", "Jan", "Matěj", "Adam", "Vojtěch", "Radek", "Michal", "Dominik", "Šimon"],
    last: ["Novák", "Svoboda", "Novotný", "Dvořák", "Černý", "Procházka", "Kučera", "Veselý", "Horák", "Němec", "Pokorný", "Marek", "Pospíšil", "Hájek", "Jelínek", "Král", "Růžička", "Beneš", "Fiala", "Sedláček"],
  },
  SVK: {
    w: 2,
    first: ["Marek", "Juraj", "Šimon", "Dalibor", "Martin", "Tomáš", "Adam", "Samuel", "Michal", "Erik"],
    last: ["Horváth", "Kováč", "Varga", "Tóth", "Nagy", "Baláž", "Szabó", "Molnár", "Lukáč", "Gajdoš", "Chára", "Slafkovský", "Pekár"],
  },
  SUI: { w: 2, first: ["Nico", "Kevin", "Timo", "Janis", "Nino", "Roman", "Lian", "Denis", "Pius", "Reto"], last: ["Müller", "Meier", "Schmid", "Keller", "Weber", "Huber", "Moser", "Brunner", "Baumann", "Frei", "Zehnder", "Bichsel"] },
  GER: { w: 1, first: ["Leon", "Moritz", "Tim", "Lukas", "Nico", "Dominik", "Jonas", "Philipp"], last: ["Schneider", "Fischer", "Wagner", "Becker", "Hoffmann", "Schäfer", "Koch", "Richter", "Klein", "Wolf"] },
};

const NATIONS = Object.keys(POOLS);
const TOTAL_W = NATIONS.reduce((s, n) => s + POOLS[n].w, 0);

export function randomNation() {
  let r = rand() * TOTAL_W;
  for (const n of NATIONS) {
    r -= POOLS[n].w;
    if (r <= 0) return n;
  }
  return "CAN";
}

export function randomName(nation = randomNation()) {
  const pool = POOLS[nation] || POOLS.CAN;
  return { name: `${pick(pool.first)} ${pick(pool.last)}`, nat: nation };
}

// Same as randomName, drawing from a keyed stream (see rng.stream) instead of the main one.
export function randomNameWith(r, nation) {
  let n = nation;
  if (!n) {
    let x = r.next() * TOTAL_W;
    n = NATIONS.find((k) => (x -= POOLS[k].w) <= 0) || "CAN";
  }
  const pool = POOLS[n] || POOLS.CAN;
  return { name: `${r.pick(pool.first)} ${r.pick(pool.last)}`, nat: n };
}
