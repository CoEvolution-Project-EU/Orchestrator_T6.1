// src/controllers/tools.controller.js
import { Tool } from '../models/tools.model.js'

// ── Register a tool ───────────────────────────────────────────
// POST /api/v1/tools/register
const registerTool = async (req, res) => {
  try {
    const { tool_id, name, description, tool_type, github_url, tags } = req.body

    // Validate required fields
    if (!tool_id || !name  || !tool_type || !github_url) {
      return res.status(400).json({
        message: 'tool_id, name, tool_type and github_url are required'
      })
    }

    const tool = await Tool.create({
      tool_id,
      name,
      description,
      tool_type,
      github_url,
      uploadedBy: req.user.username,  // from Keycloak token — never from body
      tags:       tags || [],
    })

    res.status(201).json({
      message: 'Tool registered successfully',
      tool
    })
  } catch (error) {
    // Handle duplicate tool_id
    if (error.code === 11000) {
      return res.status(400).json({ message: `Tool with id "${req.body.tool_id}" already exists` })
    }
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// ── Get all tools ─────────────────────────────────────────────
// GET /api/v1/tools
// Optional filter: ?tool_type=assessment
const getAllTools = async (req, res) => {
  try {
    const { tool_type } = req.query
    const query = {}

    if (tool_type) query.tool_type = tool_type

    const tools = await Tool.find(query).sort({ createdAt: -1 })
    res.status(200).json({ count: tools.length, tools })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// ── Get tool by tool_id ───────────────────────────────────────
// GET /api/v1/tools/:tool_id
const getToolById = async (req, res) => {
  try {
    const tool = await Tool.findOne({ tool_id: req.params.tool_id })
    if (!tool) return res.status(404).json({ message: 'Tool not found' })
    res.status(200).json({ tool })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// ── Delete tool ───────────────────────────────────────────────
// DELETE /api/v1/tools/:tool_id
const deleteTool = async (req, res) => {
  try {
    const tool = await Tool.findOneAndDelete({ tool_id: req.params.tool_id })
    if (!tool) return res.status(404).json({ message: 'Tool not found' })
    res.status(200).json({ message: 'Tool deleted successfully' })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

export {
  registerTool,
  getAllTools,
  getToolById,
  deleteTool,
}