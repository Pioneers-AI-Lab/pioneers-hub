"use client";

import { useEffect, useRef } from "react";
import { createNoise3D } from "@/lib/simplexNoise";

// ----------------------------
// Fond noir anime des pages de connexion
// ----------------------------
// Meme effet que l'en-tete de thepioneer.vc (Salient « nectar animated
// gradient », reglages du site : couleur #000000, vitesse 250, mode organic) :
// un canvas de tres basse resolution (90 px sur mobile, 110 sur ordinateur),
// etire au plein ecran, peint en NOIR avec une opacite donnee par un bruit de
// Simplex qui evolue dans le temps. Le noir masque et devoile par plaques la
// trame de points en dessous (`/auth-dots.png`, l'image du site). Un voile
// noir couvre le bas, comme sur le site.
//
// Sobre en calcul (12 000 points par image au plus), en pause quand l'onglet
// est cache, fige sur une image si l'utilisateur demande moins d'animations.

const SPEED = 250;

export function AnimatedBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const resolution = window.innerWidth < 690 ? 90 : 110;
    canvas.width = resolution;
    canvas.height = resolution;
    const image = ctx.createImageData(resolution, resolution);
    const data = image.data;
    const noise3D = createNoise3D();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Etirement du bruit selon le format de l'ecran (reglage du site).
    let aspect = { x: 1.4, y: 1.4 };
    const resize = () => {
      const ratio = window.innerHeight / window.innerWidth;
      aspect = ratio < 1 ? { x: 1.4, y: 1.4 * ratio } : { x: ratio / 3, y: 1 };
    };
    resize();
    window.addEventListener("resize", resize);

    let clock = 0;
    let frame = 0;
    const draw = () => {
      for (let x = 0; x < resolution; x++) {
        for (let y = 0; y < resolution; y++) {
          const n = noise3D((x / resolution) * aspect.x, (y / resolution) * aspect.y, clock / SPEED);
          const o = 4 * (x + y * resolution);
          // RGB a 0 (noir) ; alpha 265 * n, borne a [0, 255] par le tableau.
          data[o] = 0;
          data[o + 1] = 0;
          data[o + 2] = 0;
          data[o + 3] = 265 * n;
        }
      }
      ctx.putImageData(image, 0, 0);
      clock++;
    };
    const loop = () => {
      if (!document.hidden) draw();
      frame = requestAnimationFrame(loop);
    };

    if (reduceMotion) draw();
    else frame = requestAnimationFrame(loop);
    canvas.dataset.loaded = "true";

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div aria-hidden className="auth-backdrop">
      <canvas ref={canvasRef} className="auth-backdrop-canvas" />
      <div className="auth-backdrop-fade" />
    </div>
  );
}
