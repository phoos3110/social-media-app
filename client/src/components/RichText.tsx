export default function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(/((?:@|#)[\p{L}\p{N}_]+)/u).map((part, i) =>
        /^[@#][\p{L}\p{N}_]+$/u.test(part) ? (
          <button
            type="button"
            className="text-button inline-token"
            key={i}
            onClick={() => window.dispatchEvent(new CustomEvent('po:search', { detail: part }))}
          >
            {part}
          </button>
        ) : (
          part
        ),
      )}
    </>
  );
}
