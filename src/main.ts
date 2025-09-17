import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// __dirname pour ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const chapterEnv = process.argv[2]; // ex: "21" ou "all"
const confDir = path.join(__dirname, "./environements");

function printAvailableVolumes() {
  if (!fs.existsSync(confDir)) {
    console.error(`❌ Aucun dossier de conf trouvé : ${confDir}`);
    process.exit(1);
  }
  const files = fs.readdirSync(confDir).filter(f => f.endsWith(".json"));
  const availableVolumes = files.map(f => path.parse(f).name);
  console.error(`❌ Il faut passer un volume ou 'all'. Volumes disponibles : ${availableVolumes.join(", ")} | all`);
}

if (!chapterEnv) {
  printAvailableVolumes();
  process.exit(1);
}

function runProcess(configPath: string, volumeName: string) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  const child = spawn(
    "ts-node",
    [path.join(__dirname, "app", "generate-book.ts")],
    {
      env: {
        ...process.env,
        CHAPTER_FILE: configPath,
        CHAPTER_TITLE: config.title,
        CHAPTER_AUTHOR: config.author,
        CHAPTER_ENV: volumeName
      },
      stdio: "inherit",
      shell: true // important sur Windows
    }
  );

  child.on("close", (code) => {
    console.log(`Process terminé pour '${volumeName}' avec code ${code}`);
  });
}

// Mode 'all'
if (chapterEnv === "all") {
  const files = fs.readdirSync(confDir).filter(f => f.endsWith(".json"));
  if (files.length === 0) {
    console.error("❌ Aucun fichier de configuration trouvé dans environements/");
    process.exit(1);
  }
  console.log(`✅ Mode ALL : ${files.length} fichiers trouvés`);
  for (const file of files) {
    const volumeName = path.parse(file).name;
    const configPath = path.join(confDir, file);
    runProcess(configPath, volumeName);
  }
} else {
  // Volume unique
  const configPath = path.join(confDir, `${chapterEnv}.json`);
  if (!fs.existsSync(configPath)) {
    console.error(`❌ Fichier de configuration introuvable pour '${chapterEnv}'`);
    printAvailableVolumes();
    process.exit(1);
  }
  runProcess(configPath, chapterEnv);
}
