import { Avatar } from "@mantine/core";
import type { Founder } from "@shared/types";

/**
 * La photo d'un fondateur en couverture (4:3, `.card-cover`) : la grande photo
 * (Storage), a defaut la vignette de 128 px, a defaut ses initiales. Carte de
 * l'annuaire et apercu de « Mon profil ».
 */
export function FounderCover({ founder }: { founder: Pick<Founder, "name" | "photoUrl" | "coverPhotoUrl"> }) {
  const src = founder.coverPhotoUrl || founder.photoUrl;
  return (
    <div className="card-cover">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL Storage a jeton ou data URL : next/image n'apporte rien.
        <img src={src} alt="" loading="lazy" decoding="async" />
      ) : (
        <Avatar name={founder.name} color="initials" size={96} radius="xl" />
      )}
    </div>
  );
}
