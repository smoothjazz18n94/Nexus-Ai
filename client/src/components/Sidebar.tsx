import { useMemo } from "react";
import { groupConversations } from "../lib/groupConversations";
import type { Conversation } from "../types";
import { ConversationItem } from "./ConversationItem";
import { Mark, PlusIcon, SearchIcon } from "./Icons";

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  search: string;
  onSearch: (q: string) => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export function Sidebar({ conversations, activeId, search, onSearch, onNew, onSelect, onRename, onDelete }: Props) {
  const groups = useMemo(() => groupConversations(conversations), [conversations]);

  return (
    <div className="sidebar-inner">
      <div className="brand"><Mark size={24} /><span>Nexus AI</span></div>
      <button type="button" className="btn new-chat" onClick={onNew}><PlusIcon /> New conversation</button>
      <label className="search">
        <SearchIcon width={16} height={16} />
        <input type="search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search conversations" aria-label="Search conversations" />
      </label>
      <nav className="conv-scroll" aria-label="Conversations">
        {groups.length === 0 && (
          <p className="muted small pad">{search ? "No conversations match your search." : "Your conversations will appear here."}</p>
        )}
        {groups.map((g) => (
          <section key={g.label}>
            <h2>{g.label}</h2>
            <ul>
              {g.items.map((c) => (
                <ConversationItem
                  key={c.id}
                  conversation={c}
                  active={c.id === activeId}
                  onSelect={() => onSelect(c.id)}
                  onRename={(t) => onRename(c.id, t)}
                  onDelete={() => onDelete(c.id)}
                />
              ))}
            </ul>
          </section>
        ))}
      </nav>
    </div>
  );
}
