/**
 * Versión visible en el pie de la web y en /api/health.
 *
 * Sirve para saber de un vistazo qué build está desplegado: si la web muestra
 * una versión distinta a la que devuelve la API, hay caché o un despliegue a
 * medias. Súbela al cambiar algo que se note en la interfaz.
 */
export const VERSION = '1.2.0';
