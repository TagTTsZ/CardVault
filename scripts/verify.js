const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const setsFile = path.join(ROOT, 'data', 'catalogo', 'sets.json');
const cardsDir = path.join(ROOT, 'data', 'catalogo', 'cards');
const assetsDir = path.join(ROOT, 'public', 'assets', 'cards');

const sets = fs.existsSync(setsFile) ? JSON.parse(fs.readFileSync(setsFile, 'utf8')) : [];
let cards = 0;
let cardFiles = 0;

if (fs.existsSync(cardsDir)) {
  for (const f of fs.readdirSync(cardsDir).filter(x => x.endsWith('.json'))) {
    cardFiles++;
    cards += JSON.parse(fs.readFileSync(path.join(cardsDir, f), 'utf8')).length;
  }
}
const images = fs.existsSync(assetsDir)
  ? fs.readdirSync(assetsDir).filter(x => x.endsWith('.png')).length
  : 0;

console.log(`Coleções: ${sets.length}`);
console.log(`Arquivos de coleção: ${cardFiles}`);
console.log(`Cartas: ${cards}`);
console.log(`Imagens locais: ${images}`);
