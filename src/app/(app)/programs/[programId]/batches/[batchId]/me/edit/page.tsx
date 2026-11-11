"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  Button,
  MultiSelect,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { ExistingCoFounders, FounderDirectory, ListKey } from "@shared/types";
import { useAuth } from "@/context/AuthContext";
import { useBatch } from "@/context/BatchContext";
import { useFounder } from "@/context/FounderContext";
import { useLists } from "@/context/ListsContext";
import { useProgram } from "@/context/ProgramContext";
import { saveMyProfile, type MyProfilePatch } from "@/lib/profile";
import { paths } from "@/lib/paths";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { Section } from "@/components/ui/Section";

// ----------------------------
// « Mon profil » : le fondateur verifie et complete son profil importe
// ----------------------------
// Seuls les champs de FOUNDER_SELF_EDITABLE (shared/access.ts) sont proposes,
// et seuls les champs MODIFIES sont envoyes : rien n'ecrase une valeur que le
// fondateur n'a pas touchee.

type Draft = {
  founder: Required<MyProfilePatch["founder"]>;
  directory: Required<MyProfilePatch["directory"]>;
  profile: Required<MyProfilePatch["profile"]>;
};

function changed<T extends Record<string, unknown>>(initial: T, current: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(current) as (keyof T)[]) {
    if (JSON.stringify(initial[key]) !== JSON.stringify(current[key])) out[key] = current[key];
  }
  return out;
}

const T_SHIRTS = ["XS", "S", "M", "L", "XL", "XXL"];

/** Oui / Non / non renseigne, en un geste. */
function YesNo({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <Stack gap={6}>
      <Text size="sm" fw={500}>
        {label}
      </Text>
      <SegmentedControl
        fullWidth
        value={value === null ? "unset" : value ? "yes" : "no"}
        onChange={(v) => onChange(v === "unset" ? null : v === "yes")}
        data={[
          { value: "unset", label: "Not set" },
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]}
      />
    </Stack>
  );
}

/** Valeurs d'une liste fermee ; saisie libre tant que la liste est vide. */
function ListPicker({
  label,
  listKey,
  value,
  onChange,
  max,
}: {
  label: string;
  listKey: ListKey;
  value: string[];
  onChange: (v: string[]) => void;
  max?: number;
}) {
  const { values } = useLists();
  const options = [...new Set([...values(listKey), ...value])];
  if (values(listKey).length === 0) {
    return <TagsInput label={label} value={value} onChange={onChange} maxTags={max} placeholder="Type and press Enter" />;
  }
  return <MultiSelect label={label} data={options} value={value} onChange={onChange} searchable maxValues={max} hidePickedOptions />;
}

export default function EditMyProfilePage() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { user } = useAuth();
  const { founder, directory, profile, isDetailsLoading } = useFounder();
  const { values: listValues } = useLists();
  const meHref = paths.me(program.id, batch.id);

  // Un document importe porte tous ses champs ; un document plus ancien ou
  // ecrit a la main peut en manquer : chaque valeur a donc sa valeur vide.
  const initial: Draft | null =
    isDetailsLoading || !directory
      ? null
      : {
          founder: {
            hardSkills: founder.hardSkills ?? [],
            industries: founder.industries ?? [],
            rolesICouldTake: founder.rolesICouldTake ?? [],
            publicProfileConsent: founder.publicProfileConsent ?? false,
          },
          directory: {
            whatsapp: directory.whatsapp ?? null,
            linkedinUrl: directory.linkedinUrl ?? null,
            phone: directory.phone ?? null,
            gender: directory.gender ?? null,
            nationality: directory.nationality ?? null,
            country: directory.country ?? null,
            introduceYourself: directory.introduceYourself ?? null,
            education: directory.education ?? null,
            degree: directory.degree ?? null,
            fieldOfStudy: directory.fieldOfStudy ?? null,
            yearsOfXP: directory.yearsOfXP ?? null,
            notableCompanies: directory.notableCompanies ?? [],
            trackRecord: directory.trackRecord ?? null,
            interestedInWorkingOn: directory.interestedInWorkingOn ?? null,
            hasExistingProject: directory.hasExistingProject ?? null,
            projectExplanation: directory.projectExplanation ?? null,
            hasExistingCoFounders: directory.hasExistingCoFounders ?? null,
            openToJoinAnotherProject: directory.openToJoinAnotherProject ?? null,
            mainStartup2025: directory.mainStartup2025 ?? null,
            lookingForCoFounder: directory.lookingForCoFounder ?? null,
            coFounderTypeWanted: directory.coFounderTypeWanted ?? null,
            coFounderSkillsWanted: directory.coFounderSkillsWanted ?? [],
            industriesToExplore: directory.industriesToExplore ?? [],
          },
          profile: { housingSupport: profile?.housingSupport ?? null, tShirtSize: profile?.tShirtSize ?? null },
        };

  if (!initial) {
    if (isDetailsLoading) return <PageLoader />;
    return (
      <>
        <PageHeader back={{ href: meHref, label: "My profile" }} title="Edit profile" />
        <Text c="dimmed">Your onboarding answers are not imported yet. The Pioneers team will do it shortly.</Text>
      </>
    );
  }
  return <EditForm key={founder.updatedDateISOString} initial={initial} canWriteIdentity={user?.personId === founder.personId} degrees={listValues("degrees")} />;
}

function EditForm({ initial, canWriteIdentity, degrees }: { initial: Draft; canWriteIdentity: boolean; degrees: string[] }) {
  const router = useRouter();
  const { program } = useProgram();
  const { batch } = useBatch();
  const { founder } = useFounder();
  const [draft, setDraft] = useState<Draft>(initial);
  const [isSaving, setIsSaving] = useState(false);
  const meHref = paths.me(program.id, batch.id);

  const setF = <K extends keyof Draft["founder"]>(k: K, v: Draft["founder"][K]) => setDraft((d) => ({ ...d, founder: { ...d.founder, [k]: v } }));
  const setD = <K extends keyof Draft["directory"]>(k: K, v: Draft["directory"][K]) => setDraft((d) => ({ ...d, directory: { ...d.directory, [k]: v } }));
  const setP = <K extends keyof Draft["profile"]>(k: K, v: Draft["profile"][K]) => setDraft((d) => ({ ...d, profile: { ...d.profile, [k]: v } }));
  const text = (v: string) => (v.trim() === "" ? null : v);
  const dir = draft.directory;

  const patch: MyProfilePatch = {
    founder: changed(initial.founder, draft.founder),
    directory: changed(initial.directory as Record<string, unknown>, dir as Record<string, unknown>) as Partial<FounderDirectory>,
    profile: changed(initial.profile, draft.profile),
  };
  const dirty = Object.keys(patch.founder).length + Object.keys(patch.directory).length + Object.keys(patch.profile).length > 0;

  const save = async () => {
    setIsSaving(true);
    try {
      await saveMyProfile(founder, patch, canWriteIdentity);
      notifications.show({ message: "Profile saved" });
      router.push(meHref);
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
      setIsSaving(false);
    }
  };

  return (
    <>
      <PageHeader back={{ href: meHref, label: "My profile" }} title="Edit profile" subtitle="Visible to the founders of your batch, the Pioneers team and investors." />

      <Section title="Skills">
        <Stack>
          <ListPicker label="Hard skills" listKey="hardSkills" value={draft.founder.hardSkills} onChange={(v) => setF("hardSkills", v)} max={3} />
          <ListPicker label="Industries" listKey="industries" value={draft.founder.industries} onChange={(v) => setF("industries", v)} />
          <ListPicker label="Roles I could take" listKey="positionFit" value={draft.founder.rolesICouldTake} onChange={(v) => setF("rolesICouldTake", v)} />
        </Stack>
      </Section>

      <Section title="Contact" hint={canWriteIdentity ? undefined : "Your account is not linked to your identity yet: ask the team to change your phone, WhatsApp or LinkedIn."}>
        <Stack>
          <TextInput label="Phone" type="tel" disabled={!canWriteIdentity} value={dir.phone ?? ""} onChange={(e) => setD("phone", text(e.currentTarget.value))} />
          <TextInput label="WhatsApp" type="tel" disabled={!canWriteIdentity} value={dir.whatsapp ?? ""} onChange={(e) => setD("whatsapp", text(e.currentTarget.value))} />
          <TextInput label="LinkedIn" type="url" disabled={!canWriteIdentity} placeholder="https://linkedin.com/in/..." value={dir.linkedinUrl ?? ""} onChange={(e) => setD("linkedinUrl", text(e.currentTarget.value))} />
          <TextInput label="Country" value={dir.country ?? ""} onChange={(e) => setD("country", text(e.currentTarget.value))} />
          <TextInput label="Nationality" value={dir.nationality ?? ""} onChange={(e) => setD("nationality", text(e.currentTarget.value))} />
          <TextInput label="Gender" value={dir.gender ?? ""} onChange={(e) => setD("gender", text(e.currentTarget.value))} />
        </Stack>
      </Section>

      <Section title="About">
        <Stack>
          <Textarea label="Introduce yourself" autosize minRows={3} value={dir.introduceYourself ?? ""} onChange={(e) => setD("introduceYourself", text(e.currentTarget.value))} />
          <Textarea label="Track record" description="What you are most proud of, in 2 to 4 points." autosize minRows={3} value={dir.trackRecord ?? ""} onChange={(e) => setD("trackRecord", text(e.currentTarget.value))} />
        </Stack>
      </Section>

      <Section title="Background">
        <Stack>
          <TextInput label="Main education" value={dir.education ?? ""} onChange={(e) => setD("education", text(e.currentTarget.value))} />
          <Select
            label="Degree"
            data={[...new Set([...degrees, ...(dir.degree ? [dir.degree] : [])])]}
            value={dir.degree}
            onChange={(v) => setD("degree", v)}
            clearable
            allowDeselect
          />
          <TextInput label="Field of study" value={dir.fieldOfStudy ?? ""} onChange={(e) => setD("fieldOfStudy", text(e.currentTarget.value))} />
          <NumberInput label="Years of experience" min={0} max={60} value={dir.yearsOfXP ?? ""} onChange={(v) => setD("yearsOfXP", typeof v === "number" ? v : null)} />
          <TagsInput label="Notable companies" value={dir.notableCompanies} onChange={(v) => setD("notableCompanies", v)} placeholder="Type and press Enter" />
          <TextInput label="Main startup in 2025" value={dir.mainStartup2025 ?? ""} onChange={(e) => setD("mainStartup2025", text(e.currentTarget.value))} />
        </Stack>
      </Section>

      <Section title="Looking for">
        <Stack>
          <Textarea label="What I am interested in working on" autosize minRows={2} value={dir.interestedInWorkingOn ?? ""} onChange={(e) => setD("interestedInWorkingOn", text(e.currentTarget.value))} />
          <YesNo label="Looking for a co-founder" value={dir.lookingForCoFounder} onChange={(v) => setD("lookingForCoFounder", v)} />
          <TextInput label="Type of co-founder wanted" value={dir.coFounderTypeWanted ?? ""} onChange={(e) => setD("coFounderTypeWanted", text(e.currentTarget.value))} />
          <ListPicker label="Skills wanted in a co-founder" listKey="hardSkills" value={dir.coFounderSkillsWanted} onChange={(v) => setD("coFounderSkillsWanted", v)} />
          <ListPicker label="Industries to gain experience in" listKey="industries" value={dir.industriesToExplore} onChange={(v) => setD("industriesToExplore", v)} />
          <YesNo label="Open to join another project" value={dir.openToJoinAnotherProject} onChange={(v) => setD("openToJoinAnotherProject", v)} />
          <YesNo label="I have an existing project" value={dir.hasExistingProject} onChange={(v) => setD("hasExistingProject", v)} />
          {dir.hasExistingProject && (
            <Textarea label="The project in a few words" autosize minRows={2} value={dir.projectExplanation ?? ""} onChange={(e) => setD("projectExplanation", text(e.currentTarget.value))} />
          )}
          <Select
            label="Existing co-founders"
            data={[
              { value: "in_batch", label: "In the batch" },
              { value: "outside_batch", label: "Outside the batch" },
              { value: "none", label: "None" },
            ]}
            value={dir.hasExistingCoFounders}
            onChange={(v) => setD("hasExistingCoFounders", v as ExistingCoFounders | null)}
            clearable
          />
        </Stack>
      </Section>

      <Section title="Private" hint="Only you and the Pioneers team see this.">
        <Stack>
          <Select label="T-shirt size" data={T_SHIRTS} value={draft.profile.tShirtSize} onChange={(v) => setP("tShirtSize", v)} clearable />
          <YesNo label="I need help with housing" value={draft.profile.housingSupport} onChange={(v) => setP("housingSupport", v)} />
        </Stack>
      </Section>

      <Section title="Visibility">
        <Switch
          size="md"
          label="Show my card on the public pages"
          description="Name, photo, skills and startup. Your contact details always stay inside the batch."
          checked={draft.founder.publicProfileConsent}
          onChange={(e) => setF("publicProfileConsent", e.currentTarget.checked)}
        />
      </Section>

      <Box className="savebar">
        <Button size="md" fullWidth disabled={!dirty} loading={isSaving} onClick={save}>
          {dirty ? "Save changes" : "No changes"}
        </Button>
      </Box>
    </>
  );
}
