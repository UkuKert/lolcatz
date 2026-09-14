export default function Home() {
  const boards = [
    { id: "b", name: "Random" },
    { id: "g", name: "Technology" },
    { id: "k", name: "Weapons" },
    { id: "a", name: "Anime" },
    { id: "mu", name: "Music" },
    { id: "v", name: "Video Games" },
  ];
  return (
    <div>
      <h2 style={{ marginBottom: 12, color: "#34345c" }}>Boards</h2>
      <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 600 }}>
        <tbody>
          {boards.map(b => (
            <tr key={b.id} style={{ borderBottom: "1px solid #d9bfb7" }}>
              <td style={{ padding: "6px 12px", fontWeight: "bold" }}>
                <a href={`/board/${b.id}`} style={{ color: "#0f0c5d" }}>/{b.id}/ — {b.name}</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
