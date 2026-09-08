/** Document is an application JSON shape with no string index signature.
 * The code generator uses this interface as a static contract. Applications
 * can add a codec when reading untrusted JSON needs runtime shape checks.
 */
export interface Document {
  title: string;
  tags: string[];
}
