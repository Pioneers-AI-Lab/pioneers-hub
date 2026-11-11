"use client";

import { useEffect, useMemo, useState } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import { Box, Text } from "@mantine/core";

// ----------------------------
// Carte des nationalites (dashboard Spring 2026, « Nationalities »)
// ----------------------------
// Meme rendu que la reference (projection Natural Earth, pays representes
// pleins en bleu Pioneers, les autres en contour fin) sans react-simple-maps :
// d3-geo trace les pays, le fond de carte (world-atlas, 110m) est charge a la
// demande pour ne pas alourdir les autres pages.
// Mobile d'abord : la carte donne la vue d'ensemble, la LISTE dessous donne les
// chiffres (un petit pays ne se touche pas au doigt). Un appui sur un pays le
// selectionne ; le survol n'ajoute qu'un retour visuel, en CSS (`.map-country`).

type CountryProps = { name: string };

/** Noms usuels (base) -> noms du fond de carte. */
const ALIASES: Record<string, string> = {
  "united states": "United States of America",
  usa: "United States of America",
  us: "United States of America",
  uk: "United Kingdom",
  "great britain": "United Kingdom",
  "czech republic": "Czechia",
  "south korea": "South Korea",
  korea: "South Korea",
  "ivory coast": "Côte d'Ivoire",
  "cote d'ivoire": "Côte d'Ivoire",
  "democratic republic of the congo": "Dem. Rep. Congo",
  "dominican republic": "Dominican Rep.",
  "bosnia and herzegovina": "Bosnia and Herz.",
  "north macedonia": "Macedonia",
  "central african republic": "Central African Rep.",
  uae: "United Arab Emirates",
};

const WIDTH = 800;
const HEIGHT = 420;

export function NationalityMap({ counts }: { counts: Record<string, number> }) {
  const [countries, setCountries] = useState<Feature<Geometry, CountryProps>[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    import("world-atlas/countries-110m.json").then((mod) => {
      const topology = (mod.default ?? mod) as unknown as Topology<{ countries: GeometryCollection<CountryProps> }>;
      const fc = feature(topology, topology.objects.countries) as FeatureCollection<Geometry, CountryProps>;
      if (alive) setCountries(fc.features);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Effectif par nom du fond de carte.
  const byMapName = useMemo(() => {
    const out = new Map<string, number>();
    for (const [name, n] of Object.entries(counts)) {
      const mapName = ALIASES[name.trim().toLowerCase()] ?? name.trim();
      out.set(mapName, (out.get(mapName) ?? 0) + n);
    }
    return out;
  }, [counts]);

  const path = useMemo(() => {
    const projection = geoNaturalEarth1().scale(150).translate([WIDTH / 2, HEIGHT / 2 + 10]);
    return geoPath(projection);
  }, []);

  // Les nationalites, de la plus representee a la moins : les chiffres lisibles sans viser la carte.
  const listed = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  return (
    <>
    <Box pos="relative">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label="Founders' nationalities on a world map" style={{ display: "block" }}>
        {(countries ?? []).map((c, i) => {
          const name = c.properties.name;
          const n = byMapName.get(name) ?? 0;
          return (
            <path
              key={`${name}-${i}`}
              className="map-country"
              data-present={n > 0}
              data-selected={selected === name}
              d={path(c) ?? undefined}
              strokeWidth={0.5}
              onClick={() => setSelected(selected === name ? null : name)}
            >
              <title>{n > 0 ? `${name}: ${n}` : name}</title>
            </path>
          );
        })}
      </svg>
      {selected && (
        <Text size="xs" c="dimmed" pos="absolute" left={0} bottom={0}>
          {selected}
          {byMapName.get(selected) ? ` · ${byMapName.get(selected)}` : " · none"}
        </Text>
      )}
    </Box>
    <Text size="xs" c="dimmed" mt="xs">
      {listed.map(([name, n], i) => (
        <span key={name}>
          {i > 0 ? " · " : ""}
          {name} <Text span c="white" fw={600} inherit className="num">{n}</Text>
        </span>
      ))}
    </Text>
    </>
  );
}
