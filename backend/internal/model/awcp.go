package model

// AWCPSettings controls the website's built-in browser interface, not MCP.
type AWCPSettings struct {
	ActiveEnabled bool  `json:"activeEnabled"`
	Version       int64 `json:"version"`
}
