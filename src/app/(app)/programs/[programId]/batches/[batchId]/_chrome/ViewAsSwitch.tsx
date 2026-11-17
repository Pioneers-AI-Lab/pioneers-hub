"use client";

import { useState } from "react";
import { Button, Menu, Select, Text } from "@mantine/core";
import type { BatchRole } from "@shared/access";
import { useBatch } from "@/context/BatchContext";
import { useFounders } from "@/context/FoundersContext";
import { useParamsTS } from "@/hooks/useParamsTS";
import { setViewAs } from "@/lib/viewAs";
import { ExpandChevron } from "@/components/ui/Rows";

const VIEW_LABEL: Record<BatchRole, string> = {
  staff: "Staff",
  investor_ic: "IC investor",
  investor_portfolio: "Portfolio investor",
  founder: "Founder",
  public: "Public",
};

/**
 * « View as » du staff (lib/viewAs.ts), a la place de son etiquette de role dans
 * la ligne du batch (BatchShell) : le role choisi, en orange tant que ce n'est
 * pas Staff. A monter si `canViewAs` (BatchContext) : en apercu, `role` n'est plus staff.
 * Sur la fiche d'un fondateur (ou son edition), la vue Founder l'incarne, LUI :
 * pas besoin de le chercher dans la liste.
 */
export function ViewAsSwitch() {
  const { batch, role, viewerFounderId } = useBatch();
  const { founderId: pageFounderId } = useParamsTS<{ founderId?: string }>();
  const [isOpen, setOpen] = useState(false);
  const previewing = role !== "staff";
  const pick = (next: BatchRole) =>
    setViewAs(next === "staff" ? null : { role: next, batchId: batch.id, founderId: pageFounderId || viewerFounderId });

  return (
    // Le chevron se retourne tant que le menu est ouvert (docs/UI-RULES.md §9).
    <Menu position="bottom-end" withinPortal opened={isOpen} onChange={setOpen}>
      <Menu.Target>
        <Button
          size="compact-sm"
          h={40}
          variant={previewing ? "light" : "subtle"}
          color={previewing ? "orange" : "pioneers"}
          rightSection={<ExpandChevron expanded={isOpen} size={14} />}
          style={{ flexShrink: 0 }}
        >
          {previewing ? `As ${VIEW_LABEL[role]}` : VIEW_LABEL.staff}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>View this batch as</Menu.Label>
        {(Object.keys(VIEW_LABEL) as BatchRole[]).map((r) => (
          <Menu.Item key={r} onClick={() => pick(r)} fw={r === role ? 600 : undefined}>
            {VIEW_LABEL[r]}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

/** Vue Founder : le fondateur incarne (sa fiche « Me », son To do, sa shortlist), sous la ligne du batch. */
export function ViewAsFounderPicker() {
  const { batch, role, viewerFounderId } = useBatch();
  const { founders } = useFounders();
  if (role !== "founder") return null;

  return (
    <>
      <Select
        searchable
        placeholder="Choose a founder"
        nothingFoundMessage="No founder matches"
        data={founders.map((f) => ({ value: f.id, label: f.name }))}
        value={viewerFounderId}
        onChange={(founderId) => setViewAs({ role: "founder", batchId: batch.id, founderId })}
        allowDeselect={false}
      />
      <Text size="xs" c="dimmed" mt={4} mb="xs">
        Preview only: actions still use your staff account.
      </Text>
    </>
  );
}
