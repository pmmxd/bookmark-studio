import QRCode from "qrcode";

export async function toDataUrl(
  text: string,
  size = 320,
  dark = false,
): Promise<string> {
  return await QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: size,
    color: {
      dark: dark ? "#e5e7eb" : "#111111",
      light: dark ? "#0b1220" : "#ffffff",
    },
  });
}
