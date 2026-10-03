// server.js – Verbindung zum Server (Supabase). Einzige Stelle mit Anbieter-Angaben
// (zusammen mit anmeldung.js). Die Abfragen selbst kommen in Etappe 2, Schritt D.
//
// Beide Werte sind öffentlich und dürfen im Repo stehen: Der Schlüssel erlaubt nur, was die
// Datenbank (Row Level Security, Rechte in datenbank/schema.sql) zulässt.
// Der geheime Schlüssel (secret) kommt NIE hierher, auch nicht ins Repo.

export const SERVER_ADRESSE = 'https://ewvhbgpxlmnvaqjkobgo.supabase.co';
export const OEFFENTLICHER_SCHLUESSEL = 'sb_publishable_3FqMIFogQnjx0GYSNwQKsg_QSAGI1j2';
