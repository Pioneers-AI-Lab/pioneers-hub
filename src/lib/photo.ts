// ----------------------------
// Photo d'un fondateur, preparee dans le navigateur
// ----------------------------
// Une image choisie devient (memes tailles que scripts/import-fa26.mjs) :
//   - la grande photo : 800 px au plus sur son grand cote, JPEG (Storage) ;
//   - la vignette des avatars : 128 x 128, recadree au centre (un peu vers le
//     haut, ou est le visage), JPEG en data URL (`photoUrl`).
// L'orientation EXIF est appliquee. Une image trop petite est refusee : la
// couverture de la carte doit rester nette (« HD photo », profil complet).

const COVER_MAX = 800;
const THUMB_SIZE = 128;
/** Plus petit cote minimal d'une photo HD. */
export const PHOTO_MIN_SIDE = 400;

export type PreparedPhoto = { cover: Blob; thumbnail: string };

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser cannot process images.");
  context.imageSmoothingQuality = "high";
  return { canvas, context };
}

/** Dessine la grande photo et la vignette ; l'image decodee (jusqu'a ~200 Mo pour 48 MP) est liberee aussitot. */
function draw(bitmap: ImageBitmap) {
  const { width, height } = bitmap;
  if (Math.min(width, height) < PHOTO_MIN_SIDE) {
    throw new Error(`This photo is too small (${width} x ${height} px). Use one at least ${PHOTO_MIN_SIDE} px on each side.`);
  }
  const scale = Math.min(1, COVER_MAX / Math.max(width, height));
  const big = canvasOf(Math.round(width * scale), Math.round(height * scale));
  big.context.drawImage(bitmap, 0, 0, big.canvas.width, big.canvas.height);

  // Vignette tiree de la grande photo : recadrage carre, centre en largeur, un peu vers le haut.
  const w = big.canvas.width;
  const h = big.canvas.height;
  const side = Math.min(w, h);
  const small = canvasOf(THUMB_SIZE, THUMB_SIZE);
  small.context.drawImage(big.canvas, (w - side) / 2, (h - side) * 0.3, side, side, 0, 0, THUMB_SIZE, THUMB_SIZE);
  return { big: big.canvas, thumbnail: small.canvas.toDataURL("image/jpeg", 0.8) };
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This image format is not supported. Use a JPEG or PNG photo.");
  }
  let drawn: ReturnType<typeof draw>;
  try {
    drawn = draw(bitmap);
  } finally {
    bitmap.close();
  }
  const cover = await new Promise<Blob>((resolve, reject) =>
    drawn.big.toBlob((b) => (b ? resolve(b) : reject(new Error("The photo could not be encoded."))), "image/jpeg", 0.85),
  );
  return { cover, thumbnail: drawn.thumbnail };
}
