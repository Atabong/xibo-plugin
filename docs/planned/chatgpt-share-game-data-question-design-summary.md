# Game Data Question Design Summary

Source chat: `https://chatgpt.com/share/69fce2ac-e510-83e8-b171-01fb0c7b06d9`

## Core Idea

The project is not just generating sports commentary. The goal is to design a system that can ask or present the right engagement question during a live match, based on game data, in a way that keeps people in a bar emotionally engaged with the game.

Near-term goal:
- Start by defining the idea and the question design.
- Ask over a live game dataset.
- Use that to shape a future trained model.

Long-term direction:
- Evolve from question generation into a broader real-time attention orchestration engine for public screens.

## Problem Framing Agreed In The Chat

The assistant and user converged on this model:

- The audience is primarily non-soccer American viewers during events like the World Cup.
- The job of the system is basically: "don't look away right now."
- The output is not only words. It can eventually include text, motion, visual emphasis, pacing, and ad timing.
- The system should react to spikes and tension, not chatter constantly.
- Match memory matters. It should preserve ongoing narratives and callbacks.

## What Was Agreed

### 1. The system should start with live questions over game data

The initial ask was to define the right kinds of questions to ask during a live game over a dataset, and to refine the concept by iterative questioning before implementation.

### 2. Baseline pacing

The desired cadence was:

- roughly every 2 minutes
- more frequently during heavy activity

So the engine should be event-driven and spike-sensitive, not on a rigid constant timer.

### 3. Visual communication matters

It was agreed that some of the engagement can be communicated visually without always using words.

This shifts the concept away from "commentary generation" toward multi-channel engagement design.

### 4. Ads should be part of the system

Revenue was explicitly acknowledged as part of the product direction.

The discussion leaned toward:

- showing prediction tension
- integrating ads
- making ad timing emotionally aware rather than fully independent

### 5. Full-screen orchestration is the long-term direction

The future is not limited to overlays/widgets. The intent is for the AI/system to eventually control full screen composition dynamically.

That implies a much larger design space:

- shrink or expand elements based on tension
- switch modes during spikes/lulls
- use cinematic or ambient states
- place monetization in emotionally appropriate windows

### 6. Tone and personality direction

From the final exchange, the strongest suggested voice was:

- a "social sports narrator"
- confident
- emotionally aware
- socially sticky
- willing to make directional claims
- not corporate/ESPN-flat
- not toxic or gambling-spam

The system should be capable of explicit probabilistic or directional framing when useful.

### 7. MVP generation model

The discussion converged on generating one best engagement unit at a time for MVP, rather than a more complex multi-agent or multi-overlay ranking system.

This keeps the first architecture simple:

- event stream
- derived signals
- tension scoring
- candidate generation
- best-unit selection
- rendering

### 8. Audience context matters

One major architectural conclusion was that excitement is not purely objective match state.

It should eventually be modeled as:

- match state × audience context

That implies future inputs like:

- geography / home market
- team affinity
- rivalry amplification
- underdog effects
- local relevance
- betting/fantasy overlap
- crowd identity

## Conceptual Direction That Emerged

The system is trending toward a real-time sports narrative operating system for public screens, not a simple stats widget.

The assistant reframed the output as an "attention packet" rather than plain text. A packet could eventually include:

- trigger type
- tension archetype
- confidence
- audience relevance
- timing urgency
- narrative claim
- supporting evidence
- emotional direction
- interruption priority
- TTL / duration
- screen behavior
- ad eligibility

## Context That Matters For Future Work

If this idea is continued in this repo/session, the following assumptions are already established:

- The engine should optimize for engagement, not neutral description.
- Questions/prompts should be socially compelling, not sterile.
- The system should preserve narrative continuity across a match.
- Silence/cooldown behavior is important so the experience does not feel exhausting.
- The model should eventually reason over both game state and audience context.
- The architecture should remain simple in MVP and expand later.

## Repository Context

Additional architecture context exists outside this repo and should be treated as relevant background:

- Frontend repo: `C:\Users\Atabong\Documents\GitHub\xibo-plugin`
- Frontend architecture/docs folder: `C:\Users\Atabong\Documents\GitHub\xibo-plugin\docs`
- Backend repo: `C:\Users\Atabong\Documents\GitHub\xibo`
- Infrastructure repo: `C:\Users\Atabong\Documents\GitHub\proxmox-infra`
- Additional infrastructure context: `C:\Users\Atabong\Documents\GitHub\xibo\infra`

This summary doc should eventually become part of the shared understanding for what will be implemented in the `xibo-plugin` repo specifically.

## Scope Relationship To This Repo

This repo is basketball-oriented, but the planned product experience should target soccer first.

That is not a contradiction. The intended product direction is:

- soccer first
- then expansion to other sports
- with this repo still being relevant because the long-term experience should generalize across sports, including basketball

So the current conversation should be interpreted as:

- immediate design target: soccer
- longer-term platform direction: multi-sport

## Good Next Steps

The chat strongly points toward these next design tasks:

1. Define the first-generation taxonomy of engagement units.
2. Define trigger conditions and evidence primitives.
3. Define pacing, interruption, and cooldown rules.
4. Define the narrative memory model.
5. Define when words vs visuals vs ads should be used.
6. Decide the exact first MVP schema for an engagement unit / attention packet.

## Short Version

The shared chat established that this product should become an audience-aware, real-time sports engagement engine for public screens. In MVP, it should generate one best engagement unit at a time from live game data, paced roughly every 2 minutes or faster during spikes, with explicit tension framing allowed. Over time it should expand from text questions into full-screen attention orchestration using visuals, narrative memory, audience context, and emotionally-aware monetization.
