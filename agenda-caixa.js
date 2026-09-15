// Contrato comum às duas telas de triagem. O banco repete as validações.
(function (root) {
  'use strict';
  function telefoneCadastroEstrito(valor) {
    let digitos = String(valor || '').replace(/\D/g, '');
    if (digitos.length === 11) digitos = '55' + digitos;
    if (!/^55[1-9][0-9]9[6-9][0-9]{7}$/.test(digitos)) return null;
    return '+' + digitos;
  }
  function estadoCadastro(item) {
    let bloqueado = /BLOQUEIO DE CADASTRO/i.test(String(item?.texto || ''));
    let confirmacao = null;
    for (const mensagem of Array.isArray(item?.conversa) ? item.conversa : []) {
      const meta = mensagem?.meta || {};
      if (/BLOQUEIO DE CADASTRO/i.test(String(mensagem?.texto || '')) || meta.tipo_operacional === 'cadastro_bloqueado') {
        bloqueado = true; confirmacao = null;
      }
      if (meta.tipo_operacional === 'cadastro_validado' && meta.cliente_id && telefoneCadastroEstrito(meta.telefone_confirmado)) {
        bloqueado = false; confirmacao = meta;
      }
    }
    return { bloqueado, confirmacao };
  }
  function cadastroBloqueado(item) { return estadoCadastro(item).bloqueado; }
  function validarConfirmacaoCadastro(item, natureza, cliente) {
    const estado = estadoCadastro(item);
    if (estado.bloqueado) throw new Error('Cadastro bloqueado. Confirme a identidade e registre a resolução na Caixa antes de agendar.');
    if (estado.confirmacao && (natureza !== 'cliente' || cliente?.id !== estado.confirmacao.cliente_id
        || telefoneCadastroEstrito(cliente?.telefone) !== telefoneCadastroEstrito(estado.confirmacao.telefone_confirmado))) {
      throw new Error('A confirmação de cadastro não corresponde ao cliente e WhatsApp escolhidos. Mantenha a pendência na Caixa.');
    }
  }
  function validarVinculo(natureza, cliente, servico) {
    if (!['cliente','avulso','pessoal','operacional'].includes(natureza)) throw new Error('Escolha a natureza do compromisso.');
    if (natureza !== 'cliente') {
      if (cliente || servico) throw new Error('Compromisso vinculado a cliente deve ser classificado como cliente.');
      return { cliente_id: null, servico_id: null };
    }
    if (!cliente?.id) throw new Error('Escolha um cliente cadastrado. Sem identidade segura, mantenha a pendência na Caixa.');
    if (!telefoneCadastroEstrito(cliente.telefone)) throw new Error('WhatsApp inválido. Confirme o número completo; nenhum dígito será acrescentado.');
    if (servico && (!servico.id || servico.cliente_id !== cliente.id)) throw new Error('O serviço não pertence ao cliente escolhido.');
    return { cliente_id: cliente.id, servico_id: servico?.id || null };
  }
  async function criarDaCaixa(db, item, dados) {
    if (cadastroBloqueado(item)) throw new Error('Cadastro bloqueado. Confirme a identidade e resolva o bloqueio na Caixa antes de agendar.');
    let cliente = null, servico = null;
    if (dados.clienteId) {
      const resposta = await db.from('clientes').select('id,telefone').eq('id', dados.clienteId).single();
      if (resposta.error) throw resposta.error;
      cliente = resposta.data;
    }
    if (dados.servicoId) {
      const resposta = await db.from('servicos').select('id,cliente_id').eq('id', dados.servicoId).single();
      if (resposta.error) throw resposta.error;
      servico = resposta.data;
    }
    const vinculo = validarVinculo(dados.natureza, cliente, servico);
    validarConfirmacaoCadastro(item, dados.natureza, cliente);
    let hora = dados.hora;
    if (dados.horaAutomatica) {
      // Após falha ao resolver a Caixa, não recalcular o horário contando o próprio compromisso.
      const anterior = await db.from('agenda').select('hora').eq('caixa_entrada_id', item.id).maybeSingle();
      if (anterior.error) throw anterior.error;
      if (anterior.data) hora = anterior.data.hora;
    }
    const { data, error } = await db.rpc('agenda_criar_da_caixa', {
      p_caixa_id: item.id, p_natureza: dados.natureza,
      p_cliente_id: vinculo.cliente_id, p_servico_id: vinculo.servico_id,
      p_titulo: dados.titulo.trim(), p_data: dados.data, p_hora: hora,
      p_tipo: dados.tipo, p_cidade: dados.cidade || null,
    });
    if (error) throw error;
    if (!data?.id || data.caixa_entrada_id !== item.id || data.status !== 'planejado'
        || data.cliente_id !== vinculo.cliente_id || data.servico_id !== vinculo.servico_id) {
      throw new Error('A gravação não confirmou a identidade esperada. A entrada permanece na Caixa para revisão.');
    }
    return data;
  }
  root.BahiaAgendaCaixa = { telefoneCadastroEstrito, estadoCadastro, cadastroBloqueado, validarConfirmacaoCadastro, validarVinculo, criarDaCaixa };
})(typeof window !== 'undefined' ? window : globalThis);
