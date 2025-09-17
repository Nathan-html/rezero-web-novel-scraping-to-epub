import axios from "axios";
import * as cheerio from "cheerio";
import * as sass from "sass";
import fs from "fs";
import path from "path";
import os from "os";
import Epub from "epub-gen";
import { fileURLToPath } from "url";

// __dirname pour ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === Récupération des variables depuis process.env ===
const chapterEnv = process.env.CHAPTER_ENV!;
const chapterTitle = process.env.CHAPTER_TITLE!;
const chapterAuthor = process.env.CHAPTER_AUTHOR!;
const chapterFile = process.env.CHAPTER_FILE!;

if (!chapterFile || !fs.existsSync(chapterFile)) {
  console.error(`❌ Fichier de configuration introuvable pour ${chapterEnv}`);
  process.exit(1);
}

// Lecture du JSON complet
const envConfig = JSON.parse(fs.readFileSync(chapterFile, "utf-8"));
const chaptersData = envConfig.chapitres;

// === Fonction pour récupérer le contenu d'un chapitre ===
async function fetchChapter(
  url: string
) {
  const response = await axios.get(url);
  const $ = cheerio.load(response.data);

  const entry = $(".entry-content, .post-content, .wp-block-post-content");
  if (!entry.length) return "<p>Pas de contenu trouvé</p>";

  const nodes = entry.children().toArray();

  let startIndex = -1;
  let endIndex = nodes.length;
  let topImageHtml = "";

  // === Options depuis le JSON ===
  const showSoundcloud = envConfig.showSoundcloud === true;
  const showFigcaption = envConfig.showFigcaption === true;

  // === Détecter début et fin du chapitre ===
  nodes.forEach((node, i) => {
    const text = $(node).text().trim();
    if (startIndex === -1 && /CHAPITRE\s+\d+\s+[–-]\s+«.*»/i.test(text)) {
      startIndex = i;
    }
    if (endIndex === nodes.length && /=Fin du Chapitre/i.test(text)) {
      endIndex = i;
    }
  });
  if (startIndex === -1) startIndex = 0;

  // === Chercher une image avant le début du chapitre ===
  const preNodes = nodes.slice(0, startIndex);
  for (const node of preNodes) {
    const img = $(node).find("img").first();
    if (img.length) {
      const figure = img.closest("figure");
      if (figure.length) {
        if (!showFigcaption) {
          figure.find("figcaption").remove(); // supprime la figcaption
        }
        topImageHtml = $.html(figure);
      } else {
        topImageHtml = $.html(img);
      }
      break; // on ne garde que la première
    }
  }

  // === Contenu principal ===
  let mainNodes = nodes.slice(startIndex, endIndex).filter(node => {
    const tag = node.tagName?.toLowerCase();
    const text = $(node).text().trim();

    if (tag === "h1" && /CHAPITRE\s+\d+/i.test(text)) return false; // titre
    if (tag === "p" && /=Fin du Chapitre/i.test(text)) return false;  // fin

    if (!showSoundcloud) {
      // supprime les <a> SoundCloud
      if (tag === "a" && ($(node).attr("href") || "").includes("soundcloud.com")) return false;
      // supprime les <iframe> SoundCloud
      if (tag === "iframe" && ($(node).attr("src") || "").includes("soundcloud.com")) return false;
      // supprime les <div> contenant des liens SoundCloud
      if (tag === "div" && $(node).find('a[href*="soundcloud.com"]').length) return false;
    }

    return true;
  });

  // === Supprimer les figcaption dans le contenu si demandé ===
  if (!showFigcaption) {
    mainNodes.forEach(node => {
      $(node).find("figcaption").remove();
    });
  }

  // === Titre du chapitre ===
  const chapitreTitleNode = nodes.find(n =>
    /CHAPITRE\s+\d+\s+[–-]\s+«.*»/i.test($(n).text())
  );
  const titleHtml = chapitreTitleNode
    ? `<h1>${$(chapitreTitleNode).text().trim()}</h1>`
    : "";

  // === Paragraphe décoratif après l'image (ou après le titre) ===
  const decoHtml = `<p class="has-text-align-center">※ ※ ※ ※ ※ ※ ※ ※ ※ ※ ※ ※ ※</p>`;
  const afterTitle = topImageHtml ? topImageHtml + decoHtml : decoHtml;

  // === Concaténation finale ===
  let content =
    titleHtml + afterTitle + mainNodes.map(n => $.html(n)).join("\n");

  // === Remplacer le paragraphe décoratif avec style inline ===
  content = content.replace(
    /<p class="has-text-align-center">※ ※ ※ ※ ※ ※ ※ ※ ※ ※ ※ ※ ※<\/p>/g,
    '<p style="text-align:center">※ ※ ※ ※ ※ ※ ※ ※ ※ ※ ※ ※ ※</p>'
  );
  return content || "<p>Pas de contenu trouvé</p>";
}


async function main() {
  // === Création d'un dossier temporaire ===
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "webtoon-"));

  try {
    // === Compile SCSS → CSS ===
    const scssPath = "src/styles/style.scss";
    const cssOutputPath = path.join(tempDir, "style.css");
    const cssResult = sass.compile(scssPath);
    fs.writeFileSync(cssOutputPath, cssResult.css);

    // === Récupération et transformation des chapitres ===
    const chapters = [];
    for (const chap of chaptersData) {
      const content = await fetchChapter(chap.url);
      chapters.push({
        title: chap.titre,
        data: `<html><head><style>${cssResult.css}</style></head><body>${content}</body></html>`
      });
    }

    // === Génération couverture dans tempDir ===
    const coverPath = path.join(
      __dirname,
      "..",
      "assets/images",
      `${envConfig.name}-cover.jpg`
    );

    // Vérifier si le fichier existe
    if (!fs.existsSync(coverPath)) {
      console.error(`❌ Couverture introuvable : ${coverPath}`);
      process.exit(1);
    }
    // === Génération EPUB directement dans dist/ ===
    const distDir = "dist";
    fs.mkdirSync(distDir, { recursive: true });
    const epubPath = path.join(distDir, `${envConfig.name}.epub`);

    const options = {
      title: chapterTitle,
      author: chapterAuthor,
      cover: coverPath,
      content: chapters,
      appendChapterTitles: false,
      tocTitle: "Sommaire"
    };

    await new Epub(options, epubPath).promise;
    console.log(`✅ EPUB généré : ${epubPath}`);

    // === Génération du preview HTML si demandé ===
    if (envConfig.preview) {
      let htmlContent =
        '<html>\n' +
        '<head>\n' +
        '  <meta charset="UTF-8">\n' +
        '  <title>' + envConfig.title + ' - Preview</title>\n' +
        '  <style>' + cssResult.css + '</style>\n' +
        '</head>\n' +
        '<body>\n' +
        '  <h1>' + envConfig.title + '</h1>\n';

      for (const chap of chaptersData) {
        const content = await fetchChapter(chap.url);
        htmlContent +=
          '  <section>\n' +
          '    <h2>' + chap.titre + '</h2>\n' +
          '    ' + content + '\n' +
          '  </section>\n';
      }

      htmlContent += '</body>\n</html>';

      const previewPath = path.join("dist", envConfig.name + '-preview.html');
      fs.writeFileSync(previewPath, htmlContent, "utf-8");
      console.log(`✅ Preview HTML généré : ${previewPath}`);
    }
  } finally {
    // === Supprime le dossier temporaire ===
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(console.error);
