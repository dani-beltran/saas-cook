import { messages } from "@saas-cook/ui/messages";
import { accountMessages } from "./account";
import type { Locale } from "./locales";
import enApiKeys from "./messages/en/api-keys.json";
import enDataJobs from "./messages/en/data-jobs.json";
import enDiscovery from "./messages/en/discovery.json";
import enFeatureUi from "./messages/en/feature-ui.json";
import enNavigation from "./messages/en/navigation.json";
import enNotifications from "./messages/en/notifications.json";
import enOrganizationSettings from "./messages/en/organization-settings.json";
import enPrivacy from "./messages/en/privacy.json";
import enProjectFiles from "./messages/en/project-files.json";
import enPublicPages from "./messages/en/public-pages.json";
import esApiKeys from "./messages/es/api-keys.json";
import esDataJobs from "./messages/es/data-jobs.json";
import esDiscovery from "./messages/es/discovery.json";
import esFeatureUi from "./messages/es/feature-ui.json";
import esNavigation from "./messages/es/navigation.json";
import esNotifications from "./messages/es/notifications.json";
import esOrganizationSettings from "./messages/es/organization-settings.json";
import esPrivacy from "./messages/es/privacy.json";
import esProjectFiles from "./messages/es/project-files.json";
import esPublicPages from "./messages/es/public-pages.json";

const catalogs = {
	en: {
		DataJobs: enDataJobs,
		Privacy: enPrivacy,
		OrganizationSettings: enOrganizationSettings,
		Notifications: enNotifications,
		PublicPages: enPublicPages,
		FeatureUi: enFeatureUi,
		Discovery: enDiscovery,
		ApiKeys: enApiKeys,
		ProjectFiles: enProjectFiles,
		Navigation: enNavigation,
	},
	es: {
		DataJobs: esDataJobs,
		Privacy: esPrivacy,
		OrganizationSettings: esOrganizationSettings,
		Notifications: esNotifications,
		PublicPages: esPublicPages,
		FeatureUi: esFeatureUi,
		Discovery: esDiscovery,
		ApiKeys: esApiKeys,
		ProjectFiles: esProjectFiles,
		Navigation: esNavigation,
	},
};
/**
 * Selects all domain-owned translation catalogs for a supported locale.
 * @param locale - A locale from the central supported-locale definition.
 * @returns Feature namespaces used by rendering and catalog completeness tests.
 */
export function featureMessages(locale: Locale) {
	return catalogs[locale];
}
/**
 * Composes the complete selected catalog for server requests, client providers and Storybook.
 * @param locale - A supported locale already resolved by the request or preview.
 * @returns Shared/account messages plus domain-owned feature namespaces; no remote loading occurs.
 */
export function localeMessages(locale: Locale) {
	return {
		...messages[locale],
		Account: accountMessages[locale],
		...featureMessages(locale),
	};
}
