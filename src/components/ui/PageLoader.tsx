import { Center, Loader } from "@mantine/core";

/** Le meme chargement partout : jamais d'ecran blanc ni de `return null`. */
export function PageLoader() {
  return (
    <Center mih={240}>
      <Loader size="sm" />
    </Center>
  );
}
