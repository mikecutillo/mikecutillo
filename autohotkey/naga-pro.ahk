#Requires AutoHotkey v2.0
#SingleInstance Force

; Razer Naga Pro side-button bindings.
;
; Setup:
;   1. In Razer Synapse, remap five side buttons to F13, F14, F15, F16, F17.
;   2. In Wispr Flow settings, set the activation hotkey to F16.
;      (Wispr listens directly — AHK does not touch F16.)
;   3. Run this script. It handles F13–F15 and F17 below.

F13::Send("^c")        ; Copy
F14::Send("^v")        ; Paste
F15::Send("{Enter}")   ; Enter
F17::Send("#+s")       ; Snip (Windows Snipping Tool)
