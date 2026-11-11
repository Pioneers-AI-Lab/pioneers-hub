import type { Archivable, BatchScoped, DateISOString, DayString, MonthString, StartupScoped, Timestamps } from "./common";
import type { MetricKey } from "./form";

// ----------------------------
// Investors (SPECS §3.3, docs/repos/ROLES.md)
// ----------------------------
//   investors/{investorId}                    Investor         staff + investors IC
//   investments/{investmentId}                Investment       staff + investors IC            (bonus)
//   portfolioReports/{startupId}_{month}      PortfolioReport  membres + staff + investors     (bonus)
//
// Le niveau d'acces (`ic` / `portfolio`) vit sur le compte (`users.investorAccess`),
// car c'est lui que lisent les regles. La fiche decrit la personne.

export type InvestorType = "pioneers_partner" | "external_vc" | "angel" | "mentor_investor";

/** Le profil d'investor. L'identite est dans `people/{personId}`, non recopiee ici. */
export type Investor = Timestamps &
  Archivable & {
    personId: string;
    type: InvestorType;
    /** Fonds ou structure. */
    fund: string | null;
    /** Ex. « Founding Partner », « Venture Partner ». */
    title: string | null;
    /** Tags de these d'investissement. */
    thesisTags: string[];
  };

/** Un investissement dans une startup (suivi du portfolio, bonus). */
export type Investment = BatchScoped &
  Timestamps & {
    startupId: string;
    investorIds: string[];
    dayString: DayString;
    /** Ex. « pre-seed ». */
    round: string | null;
    amount: number | null;
    currency: string | null;
    /** Ex. BSA AIR, equity. */
    instrument: string | null;
  };

/** Reporting mensuel d'une startup financee (decision du 11/11 : mensuel, bonus). */
export type PortfolioReport = StartupScoped & {
  monthString: MonthString;
  metrics: Partial<Record<MetricKey, number>>;
  comment: string | null;
  submittedByFounderId: string | null;
  submittedDateISOString: DateISOString;
};
