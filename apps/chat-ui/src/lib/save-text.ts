/**
 * Hand text to the person as a downloaded file. Exports read through the credentialed fetch
 * (the sign-in's bearer), so a plain `<a href>` to the route would arrive without it.
 */
export function saveText(text: string, filename: string, type = 'application/x-ndjson'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoking synchronously can beat the download starting in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
